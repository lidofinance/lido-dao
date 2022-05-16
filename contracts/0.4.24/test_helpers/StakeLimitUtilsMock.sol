
// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../lib/StakeRateLimitUtils.sol";

contract StakeLimitUtilsMock {
    using UnstructuredStorage for bytes32;
    using StakeLimitUnstructuredStorage for bytes32;
    using StakeRateLimitUtils for StakeLimitState.Data;

    bytes32 internal constant STAKE_LIMIT_POSITION = keccak256("abcdef");

    function getStorageStakeRateLimit() public view returns (
        uint32 prevStakeBlockNumber,
        uint96 prevStakeLimit,
        uint32 maxStakeLimitGrowthBlocks,
        uint96 maxStakeLimit
    ) {
        StakeLimitState.Data memory data = STAKE_LIMIT_POSITION.getStorageStakeLimitStruct();

        prevStakeBlockNumber = data.prevStakeBlockNumber;
        prevStakeLimit = data.prevStakeLimit;
        maxStakeLimitGrowthBlocks = data.maxStakeLimitGrowthBlocks;
        maxStakeLimit = data.maxStakeLimit;
    }

    function setStorageStakeRateLimitStruct(
        uint32 _prevStakeBlockNumber,
        uint96 _prevStakeLimit,
        uint32 _maxStakeLimitGrowthBlocks,
        uint96 _maxStakeLimit
    ) public returns (uint256 ret) {
        StakeLimitState.Data memory data;
        data.prevStakeBlockNumber = _prevStakeBlockNumber;
        data.prevStakeLimit = _prevStakeLimit;
        data.maxStakeLimitGrowthBlocks = _maxStakeLimitGrowthBlocks;
        data.maxStakeLimit = _maxStakeLimit;

        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(data);

        return STAKE_LIMIT_POSITION.getStorageUint256();
    }

    function calculateCurrentStakeLimit() public view returns(uint256 limit) {
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().calculateCurrentStakeLimit();
    }

    function isStakingPaused(uint256 _slotValue) public view returns(bool) {
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().isStakingPaused();
    }

    function isStakingRateLimited(uint256 _slotValue) public view returns(bool) {
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().isStakingRateLimited();
    }

    function resumeStakingWithNewLimit(uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock) public view {
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().resumeStakingWithNewLimit(
                _maxStakeLimit, _stakeLimitIncreasePerBlock
            )
        );
    }

    function updatePrevStakeLimit(uint256 _newPrevLimit) internal view returns (StakeLimitState.Data memory) {
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().updatePrevStakeLimit(_newPrevLimit)
        );
    }
}
