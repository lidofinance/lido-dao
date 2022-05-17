// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/common/UnstructuredStorage.sol";

//
// We need to pack four variables into the same 256bit-wide storage slot
// to lower the costs per each staking request.
//
// As a result, slot's memory aligned as follows:
//
// MSB ------------------------------------------------------------------------------> LSB
// 256____________160_________________________128_______________32_____________________ 0
// |_______________|___________________________|________________|_______________________|
// | maxStakeLimit | maxStakeLimitGrowthBlocks | prevStakeLimit | prevStakeBlockNumber  |
// |<-- 96 bits -->|<---------- 32 bits ------>|<-- 96 bits --->|<----- 32 bits ------->|
//
//
// NB: Internal representation conventions:
//
// - the `maxStakeLimitGrowthBlocks` field above represented as follows:
// `maxStakeLimitGrowthBlocks` = `maxStakeLimit` / `stakeLimitIncreasePerBlock`
//           32 bits                 96 bits               96 bits
//
//
// - the "staking paused" state is encoded by all fields being zero,
// - the "staking unlimited" state is encoded by `maxStakeLimit` being zero and `prevStakeBlockNumber` being non-zero.
//

/**
* @notice Library for the internal structs definitions
* @dev solidity <0.6 doesn't support top-level structs
* using the library to have a proper namespace
*/
library StakeLimitState {
    /**
      * @dev Internal representation struct (slot-wide)
      */
    struct Data {
        uint32 prevStakeBlockNumber;
        uint96 prevStakeLimit;
        uint32 maxStakeLimitGrowthBlocks;
        uint96 maxStakeLimit;
    }
}

library StakeLimitUnstructuredStorage {
    using UnstructuredStorage for bytes32;

    /// @dev Storage offset for `maxStakeLimit` (bits)
    uint256 internal constant MAX_STAKE_LIMIT_OFFSET = 160;
    /// @dev Storage offset for `maxStakeLimitGrowthBlocks` (bits)
    uint256 internal constant MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET = 128;
    /// @dev Storage offset for `prevStakeLimit` (bits)
    uint256 internal constant PREV_STAKE_LIMIT_OFFSET = 32;
    /// @dev Storage offset for `prevStakeBlockNumber` (bits)
    uint256 internal constant PREV_STAKE_BLOCK_NUMBER_OFFSET = 0;

    /**
    * @dev Read stake limit state from the unstructured storage position
    * @param _position storage offset
    */
    function getStorageStakeLimitStruct(bytes32 _position) internal view returns (StakeLimitState.Data memory ret) {
        uint256 slotValue = _position.getStorageUint256();

        ret.prevStakeBlockNumber = uint32(slotValue >> PREV_STAKE_BLOCK_NUMBER_OFFSET);
        ret.prevStakeLimit = uint96(slotValue >> PREV_STAKE_LIMIT_OFFSET);
        ret.maxStakeLimitGrowthBlocks = uint32(slotValue >> MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET);
        ret.maxStakeLimit = uint96(slotValue >> MAX_STAKE_LIMIT_OFFSET);
    }

     /**
    * @dev Write stake limit state to the unstructured storage position
    * @param _position storage offset
    * @param _data stake limit state structure instance
    */
    function setStorageStakeLimitStruct(bytes32 _position, StakeLimitState.Data memory _data) internal {
        _position.setStorageUint256(
            uint256(_data.prevStakeBlockNumber) << PREV_STAKE_BLOCK_NUMBER_OFFSET
                | uint256(_data.prevStakeLimit) << PREV_STAKE_LIMIT_OFFSET
                | uint256(_data.maxStakeLimitGrowthBlocks) << MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET
                | uint256(_data.maxStakeLimit) << MAX_STAKE_LIMIT_OFFSET
        );
    }
}

/**
* @notice Interface library with helper functions to deal with stake limit struct in a more high-level approach.
*/
library StakeLimitUtils {
    /**
    * @notice Calculate stake limit for the current block.
    * @dev special return values:
    * - 0 if limit is exhausted or staking pause was set
    * - 2^256 - 1 if there is no limit was set
    */
    function calculateCurrentStakeLimit(StakeLimitState.Data memory _data) internal view returns(uint256 limit) {
        if (!isStakingLimitApplied(_data)) {
            return uint256(-1);
        }

        uint256 stakeLimitIncPerBlock;
        if (_data.maxStakeLimitGrowthBlocks > 0) {
            stakeLimitIncPerBlock = _data.maxStakeLimit / _data.maxStakeLimitGrowthBlocks;
        }

        limit = _data.prevStakeLimit + ((block.number - _data.prevStakeBlockNumber) * stakeLimitIncPerBlock);
        if (limit > _data.maxStakeLimit) {
            limit = _data.maxStakeLimit;
        }
    }

    /**
    * @notice check if staking is on pause (i.e. every byte in the slot has a zero value)
    */
    function isStakingPaused(StakeLimitState.Data memory _data) internal pure returns(bool) {
        return (_data.maxStakeLimit == 0)
            && (_data.maxStakeLimitGrowthBlocks == 0)
            && (_data.prevStakeBlockNumber == 0)
            && (_data.prevStakeLimit == 0);
    }

    /**
    * @notice check if staking limit is applied (otherwise staking is unlimited)
    */
    function isStakingLimitApplied(StakeLimitState.Data memory _data) internal pure returns(bool) {
        return _data.maxStakeLimit != 0;
    }

    /**
    * @notice prepare stake limit repr to resume staking with the desired limits
    * @param _maxStakeLimit stake limit max value
    * @param _stakeLimitIncreasePerBlock stake limit increase (restoration) per block
    */
    function resumeStakingWithNewLimit(
        StakeLimitState.Data memory _data,
        uint256 _maxStakeLimit,
        uint256 _stakeLimitIncreasePerBlock
    ) internal view returns (StakeLimitState.Data memory) {
        require(_maxStakeLimit <= uint96(-1), "TOO_LARGE_MAX_STAKE_LIMIT");
        require(_maxStakeLimit >= _stakeLimitIncreasePerBlock, "TOO_LARGE_LIMIT_INCREASE");
        require(
            (_stakeLimitIncreasePerBlock == 0)
            || (_maxStakeLimit / _stakeLimitIncreasePerBlock <= uint32(-1)),
            "TOO_SMALL_LIMIT_INCREASE"
        );

        // if staking was paused or unlimited previously,
        // or new limit is lower than previous, then
        // reset prev stake limit to the new max stake limit
        if ((_data.maxStakeLimit == 0) || (_maxStakeLimit < _data.prevStakeLimit)) {
            _data.prevStakeLimit = uint96(_maxStakeLimit);
        }
        _data.maxStakeLimitGrowthBlocks = _stakeLimitIncreasePerBlock > 0 ? uint32(_maxStakeLimit / _stakeLimitIncreasePerBlock) : 0;

        _data.maxStakeLimit = uint96(_maxStakeLimit);
        _data.prevStakeBlockNumber = uint32(block.number);

        return _data;
    }

    /**
    * @notice update stake limit repr after submitting user's eth
    */
    function updatePrevStakeLimit(
        StakeLimitState.Data memory _data,
        uint256 _newPrevLimit
    ) internal view returns (StakeLimitState.Data memory) {
        assert(_newPrevLimit <= uint96(-1));

        _data.prevStakeLimit = uint96(_newPrevLimit);
        _data.prevStakeBlockNumber = uint32(block.number);

        return _data;
    }
}
