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
// NB: we represent `maxStakeLimitGrowthPeriod` as follows:
// `maxStakeLimitGrowthPeriod` = `maxStakeLimit` / `stakeLimitIncPerBlock`
//           32 bits                 96 bits               96 bits
//

library StakeLimitUtils {
    uint256 internal constant MAX_STAKE_LIMIT_OFFSET = 160;
    uint256 internal constant MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET = 128;
    uint256 internal constant PREV_STAKE_LIMIT_OFFSET = 32;
    uint256 internal constant PREV_STAKE_BLOCK_NUMBER_OFFSET = 0;

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
        uint96 maxStakeLimit,
        uint96 stakeLimitIncPerBlock,
        uint96 prevStakeLimit,
        uint32 prevStakeBlockNumber
    ) internal pure returns (uint256 ret) {
        ret = uint256(maxStakeLimit) << MAX_STAKE_LIMIT_OFFSET
            | uint256(prevStakeLimit) << PREV_STAKE_LIMIT_OFFSET
            | uint256(prevStakeBlockNumber) << PREV_STAKE_BLOCK_NUMBER_OFFSET;

        if (stakeLimitIncPerBlock > 0) {
            ret |= uint256(uint32(maxStakeLimit / stakeLimitIncPerBlock)) << MAX_STAKE_LIMIT_GROWTH_BLOCKS_OFFSET;
        }
    }

    /**
    * @notice Calculate stake limit for the current block.
    */
    function getCurrentStakeLimit(
        uint256 maxStakeLimit,
        uint256 stakeLimitIncPerBlock,
        uint256 prevStakeLimit,
        uint256 prevBlockNumber
    ) internal view returns(uint256 limit) {
        limit = prevStakeLimit + ((block.number - prevBlockNumber) * stakeLimitIncPerBlock);
        if (limit > maxStakeLimit) {
            limit = maxStakeLimit;
        }
    }
}
