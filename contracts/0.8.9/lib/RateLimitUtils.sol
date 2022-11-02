// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;


import "./AragonUnstructuredStorage.sol";

//
// We need to pack four variables into the same 256bit-wide storage slot
// to lower the costs per each staking request.
//
// As a result, slot's memory aligned as follows:
//
// MSB ------------------------------------------------------------------------------> LSB
// 256____________160_________________________128_______________32_____________________ 0
// |_______________|___________________________|________________|_______________________|
// | maxLimit | maxLimitGrowthBlocks | prevLimit | prevBlockNumber  |
// |<-- 96 bits -->|<---------- 32 bits ------>|<-- 96 bits --->|<----- 32 bits ------->|
//
//
// NB: Internal representation conventions:
//
// - the `maxLimitGrowthBlocks` field above represented as follows:
// `maxLimitGrowthBlocks` = `maxLimit` / `stakeLimitIncreasePerBlock`
//           32 bits                 96 bits               96 bits
//
//
// - the "staking paused" state is encoded by `prevBlockNumber` being zero,
// - the "staking unlimited" state is encoded by `maxLimit` being zero and `prevBlockNumber` being non-zero.
//

/**
* @notice Library for the internal structs definitions
* @dev solidity <0.6 doesn't support top-level structs
* using the library to have a proper namespace
*/
library LimitState {
    /**
      * @dev Internal representation struct (slot-wide)
      */
    struct Data {
        uint32 prevBlockNumber;
        uint96 prevLimit;
        uint32 maxLimitGrowthBlocks;
        uint96 maxLimit;
    }
}

library LimitUnstructuredStorage {
    using UnstructuredStorage for bytes32;

    /// @dev Storage offset for `maxLimit` (bits)
    uint256 internal constant MAX_LIMIT_OFFSET = 160;
    /// @dev Storage offset for `maxLimitGrowthBlocks` (bits)
    uint256 internal constant MAX_LIMIT_GROWTH_BLOCKS_OFFSET = 128;
    /// @dev Storage offset for `prevLimit` (bits)
    uint256 internal constant PREV_LIMIT_OFFSET = 32;
    /// @dev Storage offset for `prevBlockNumber` (bits)
    uint256 internal constant PREV_BLOCK_NUMBER_OFFSET = 0;

    /**
    * @dev Read stake limit state from the unstructured storage position
    * @param _position storage offset
    */
    function getStorageLimitStruct(bytes32 _position) internal view returns (LimitState.Data memory rateLimit) {
        uint256 slotValue = _position.getStorageUint256();

        rateLimit.prevBlockNumber = uint32(slotValue >> PREV_BLOCK_NUMBER_OFFSET);
        rateLimit.prevLimit = uint96(slotValue >> PREV_LIMIT_OFFSET);
        rateLimit.maxLimitGrowthBlocks = uint32(slotValue >> MAX_LIMIT_GROWTH_BLOCKS_OFFSET);
        rateLimit.maxLimit = uint96(slotValue >> MAX_LIMIT_OFFSET);
    }

     /**
    * @dev Write stake limit state to the unstructured storage position
    * @param _position storage offset
    * @param _data stake limit state structure instance
    */
    function setStorageLimitStruct(bytes32 _position, LimitState.Data memory _data) internal {
        _position.setStorageUint256(
            uint256(_data.prevBlockNumber) << PREV_BLOCK_NUMBER_OFFSET
                | uint256(_data.prevLimit) << PREV_LIMIT_OFFSET
                | uint256(_data.maxLimitGrowthBlocks) << MAX_LIMIT_GROWTH_BLOCKS_OFFSET
                | uint256(_data.maxLimit) << MAX_LIMIT_OFFSET
        );
    }
}

/**
* @notice Interface library with helper functions to deal with stake limit struct in a more high-level approach.
*/
library RateLimitUtils {
    /**
    * @notice Calculate stake limit for the current block.
    */
    function calculateCurrentLimit(LimitState.Data memory _data) internal view returns(uint256 limit) {
        uint256 limitIncPerBlock;
        if (_data.maxLimitGrowthBlocks != 0) {
            limitIncPerBlock = _data.maxLimit / _data.maxLimitGrowthBlocks;
        }

        limit = _data.prevLimit + ((block.number - _data.prevBlockNumber) * limitIncPerBlock);
        if (limit > _data.maxLimit) {
            limit = _data.maxLimit;
        }
    }

    /**
    * @notice update stake limit repr with the desired limits
    * @dev input `_data` param is mutated and the func returns effectively the same pointer
    * @param _data stake limit state struct
    * @param _maxLimit stake limit max value
    * @param _limitIncreasePerBlock stake limit increase (restoration) per block
    */
    function setLimit(
        LimitState.Data memory _data,
        uint256 _maxLimit,
        uint256 _limitIncreasePerBlock
    ) internal view returns (LimitState.Data memory) {
        require(_maxLimit != 0, "ZERO_MAX_LIMIT");
        require(_maxLimit < type(uint96).max, "TOO_LARGE_MAX_STAKE_IMIT");
        require(_maxLimit >= _limitIncreasePerBlock, "TOO_LARGE_LIMIT_INCREASE");
        require(
            (_limitIncreasePerBlock == 0)
            || (_maxLimit / _limitIncreasePerBlock < type(uint32).max),
            "TOO_SMALL_LIMIT_INCREASE"
        );

        // if staking was paused or unlimited previously,
        // or new limit is lower than previous, then
        // reset prev stake limit to the new max stake limit
        if ((_data.maxLimit == 0) || (_maxLimit < _data.prevLimit)) {
            _data.prevLimit = uint96(_maxLimit);
        }
        _data.maxLimitGrowthBlocks = _limitIncreasePerBlock != 0 ? uint32(_maxLimit / _limitIncreasePerBlock) : 0;

        _data.maxLimit = uint96(_maxLimit);

        if (_data.prevBlockNumber != 0) {
            _data.prevBlockNumber = uint32(block.number);
        }

        return _data;
    }


    /**
    * @notice update stake limit repr after submitting user's eth
    * @dev input `_data` param is mutated and the func returns effectively the same pointer
    * @param _data stake limit state struct
    * @param _newPrevLimit new value for the `prevLimit` field
    */
    function updatePrevLimit(
        LimitState.Data memory _data,
        uint256 _newPrevLimit
    ) internal view returns (LimitState.Data memory) {
        // assert(_newPrevLimit < type(uint96).max);
        // assert(_data.prevBlockNumber != 0);
        require(_newPrevLimit < type(uint96).max, "AAA");
        require(_data.prevBlockNumber != 0, "BBB");

        _data.prevLimit = uint96(_newPrevLimit);
        _data.prevBlockNumber = uint32(block.number);

        return _data;
    }

}
