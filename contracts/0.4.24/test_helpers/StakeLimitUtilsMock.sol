
// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../lib/StakeLimitUtils.sol";

contract StakeLimitUtilsMock {
    using UnstructuredStorage for bytes32;
    using StakeLimitUnstructuredStorage for bytes32;
    using StakeLimitUtils for StakeLimitState.Data;

    bytes32 internal constant STAKE_LIMIT_POSITION = keccak256("abcdef");

    function getStorageStakeLimit(uint256 _slotValue) public view returns (
        uint32 prevStakeBlockNumber,
        uint96 prevStakeLimit,
        uint32 maxStakeLimitGrowthBlocks,
        uint96 maxStakeLimit
    ) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        StakeLimitState.Data memory data = STAKE_LIMIT_POSITION.getStorageStakeLimitStruct();

        prevStakeBlockNumber = data.prevStakeBlockNumber;
        prevStakeLimit = data.prevStakeLimit;
        maxStakeLimitGrowthBlocks = data.maxStakeLimitGrowthBlocks;
        maxStakeLimit = data.maxStakeLimit;
    }

    function setStorageStakeLimitStruct(
        uint32 _prevStakeBlockNumber,
        uint96 _prevStakeLimit,
        uint32 _maxStakeLimitGrowthBlocks,
        uint96 _maxStakeLimit
    ) public view returns (uint256 ret) {
        StakeLimitState.Data memory data;
        data.prevStakeBlockNumber = _prevStakeBlockNumber;
        data.prevStakeLimit = _prevStakeLimit;
        data.maxStakeLimitGrowthBlocks = _maxStakeLimitGrowthBlocks;
        data.maxStakeLimit = _maxStakeLimit;

        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(data);
        return STAKE_LIMIT_POSITION.getStorageUint256();
    }

    function calculateCurrentStakeLimit(uint256 _slotValue) public view returns(uint256 limit) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().calculateCurrentStakeLimit();
    }

    function isStakingPaused(uint256 _slotValue) public view returns(bool) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().isStakingPaused();
    }

    function isStakingLimitSet(uint256 _slotValue) public view returns(bool) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        return STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().isStakingLimitSet();
    }

    function setStakingLimit(uint256 _slotValue, uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock) public view {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().setStakingLimit(
                _maxStakeLimit, _stakeLimitIncreasePerBlock
            )
        );
    }

    function removeStakingLimit(uint256 _slotValue) public view returns(uint256) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().removeStakingLimit()
        );
        return STAKE_LIMIT_POSITION.getStorageUint256();
    }

    function updatePrevStakeLimit(uint256 _slotValue, uint256 _newPrevLimit) public view returns(uint256) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().updatePrevStakeLimit(_newPrevLimit)
        );
        return STAKE_LIMIT_POSITION.getStorageUint256();
    }

    function setStakeLimitPauseState(uint256 _slotValue, bool _isPaused) public view returns(uint256) {
        STAKE_LIMIT_POSITION.setStorageUint256(_slotValue);
        STAKE_LIMIT_POSITION.setStorageStakeLimitStruct(
            STAKE_LIMIT_POSITION.getStorageStakeLimitStruct().setStakeLimitPauseState(_isPaused)
        );
        return STAKE_LIMIT_POSITION.getStorageUint256();
    }
}
