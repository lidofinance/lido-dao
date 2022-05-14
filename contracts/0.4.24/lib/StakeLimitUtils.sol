// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

//
// We need to pack four variables into the same 256bit-wide storage slot
// to lower the costs per each staking request.
//
// As a result, slot's memory aligned as follows:
//
// LSB ------------------------------------------------------------------------------> MSB
// 0______________________32______________128_________________________160______________256
// |______________________|________________|___________________________|________________|
// | prevStakeBlockNumber | prevStakeLimit | maxStakeLimitGrowthBlocks | maxStakeLimit  |
// |<----- 32 bits ------>|<-- 96 bits --->|<---------- 32 bits ------>|<--- 96 bits -->|
//
//
// NB: Internal representation conventions:
//
//  represent `maxStakeLimitGrowthBlocks` as follows:
// `maxStakeLimitGrowthBlocks` = `maxStakeLimit` / `stakeLimitIncreasePerBlock`
//           32 bits                 96 bits               96 bits
//
//
// "staking paused" state is encoded by all fields being zero,
// "staking unlimited" state is encoded by maxStakeLimit being zero and prevStakeBlockNumber being non-zero.
//

library StakeLimitUtils {
    uint256 internal constant MAX_STAKE_LIMIT_OFFSET = 160;
    uint256 internal constant MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET = 128;
    uint256 internal constant PREV_STAKE_LIMIT_OFFSET = 32;
    uint256 internal constant PREV_STAKE_BLOCK_NUMBER_OFFSET = 0;
    uint256 internal constant STAKE_LIMIT_PARAMS_MASK = uint256(-1) << MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET;

    /**
    * @notice Unpack the slot value into stake limit params and state.
    */
    function decodeStakeLimitSlot(uint256 _slotValue) internal pure returns (
        uint96 maxStakeLimit,
        uint96 stakeLimitIncPerBlock,
        uint96 prevStakeLimit,
        uint32 prevStakeBlockNumber
    ) {
        maxStakeLimit = uint96(_slotValue >> MAX_STAKE_LIMIT_OFFSET);
        uint32 growthBlocks = uint32(_slotValue >> MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET);
        if (growthBlocks > 0) {
            stakeLimitIncPerBlock = maxStakeLimit / growthBlocks;
        }
        prevStakeLimit = uint96(_slotValue >> PREV_STAKE_LIMIT_OFFSET);
        prevStakeBlockNumber = uint32(_slotValue >> PREV_STAKE_BLOCK_NUMBER_OFFSET);
    }

    /**
    * @notice Pack stake limit params and state into a slot.
    */
    function encodeStakeLimitSlot(
        uint96 _maxStakeLimit,
        uint96 _stakeLimitIncreasePerBlock,
        uint96 _prevStakeLimit,
        uint32 _prevStakeBlockNumber
    ) internal pure returns (uint256 ret) {
        require(_maxStakeLimit >= _stakeLimitIncreasePerBlock, "TOO_LARGE_INCREASE");
        require(
            (_stakeLimitIncreasePerBlock == 0)
            || (_maxStakeLimit / _stakeLimitIncreasePerBlock <= uint32(-1)),
            "TOO_SMALL_INCREASE"
        );

        ret = uint256(_maxStakeLimit) << MAX_STAKE_LIMIT_OFFSET
            | uint256(_prevStakeLimit) << PREV_STAKE_LIMIT_OFFSET
            | uint256(_prevStakeBlockNumber) << PREV_STAKE_BLOCK_NUMBER_OFFSET;

        if (_stakeLimitIncreasePerBlock > 0) {
            ret |= uint256(uint32(_maxStakeLimit / _stakeLimitIncreasePerBlock)) << MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET;
        }
    }

    /**
    * @notice Calculate stake limit for the current block.
    */
    function calculateCurrentStakeLimit(uint256 _slotValue) internal view returns(uint256 limit) {
        (
            uint96 maxStakeLimit,
            uint96 stakeLimitIncPerBlock,
            uint96 prevStakeLimit,
            uint32 prevStakeBlockNumber
        ) = decodeStakeLimitSlot(_slotValue);

        limit = prevStakeLimit + ((block.number - prevStakeBlockNumber) * stakeLimitIncPerBlock);
        if (limit > maxStakeLimit) {
            limit = maxStakeLimit;
        }
    }

    /**
    * @notice Write new prev stake limit and current block number
    */
    function updatePrevStakeLimit(uint256 _slotValue, uint256 _newPrevLimit) internal view returns(uint256) {
        return (
            (_slotValue & STAKE_LIMIT_PARAMS_MASK)
            | _newPrevLimit << PREV_STAKE_LIMIT_OFFSET
            | block.number << PREV_STAKE_BLOCK_NUMBER_OFFSET
        );
    }

    /**
    * @notice check if staking is on pause (i.e. slot contains zero value)
    */
    function isStakingPaused(uint256 _slotValue) internal pure returns(bool) {
        return (_slotValue == 0);
    }

    /**
    * @notice check if rate limit is set (otherwise staking is unlimited)
    */
    function isStakingRateLimited(uint256 _slotValue) internal pure returns(bool) {
        return uint96(_slotValue >> MAX_STAKE_LIMIT_OFFSET) != 0;
    }
}
