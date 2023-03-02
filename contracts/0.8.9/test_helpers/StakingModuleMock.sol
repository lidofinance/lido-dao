// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingModule} from "../interfaces/IStakingModule.sol";

contract StakingModuleMock is IStakingModule {
    uint256 internal _exitedValidatorsCount;
    uint256 private _activeValidatorsCount;
    uint256 private _availableValidatorsCount;
    uint256 private _nonce;

    function getActiveValidatorsCount() public view returns (uint256) {
        return _activeValidatorsCount;
    }

    function getAvailableValidatorsCount() public view returns (uint256) {
        return _availableValidatorsCount;
    }

    function getType() external view returns (bytes32) {}

    function getStakingModuleSummary() external view returns (
        uint256 totalExitedValidators,
        uint256 totalDepositedValidators,
        uint256 depositableValidatorsCount
    ) {
        totalExitedValidators = _exitedValidatorsCount;
        totalDepositedValidators = _activeValidatorsCount;
        depositableValidatorsCount = _availableValidatorsCount;
    }

    function getNodeOperatorSummary(uint256 _nodeOperatorId) external view returns (
        bool isTargetLimitActive,
        uint256 targetValidatorsCount,
        uint256 stuckValidatorsCount,
        uint256 refundedValidatorsCount,
        uint256 stuckPenaltyEndTimestamp,
        uint256 totalExitedValidators,
        uint256 totalDepositedValidators,
        uint256 depositableValidatorsCount
    ) {}

    function getNonce() external view returns (uint256) {
        return _nonce;
    }

    function setNonce(uint256 _newNonce) external {
        _nonce = _newNonce;
    }

    function getNodeOperatorsCount() external view returns (uint256) {}

    function getActiveNodeOperatorsCount() external view returns (uint256) {}

    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool) {}

    function getNodeOperatorIds(uint256 _offset, uint256 _limit)
        external
        view
        returns (uint256[] memory nodeOperatorIds) {}

    function onRewardsMinted(uint256 _totalShares) external {}

    struct Call_updateValidatorsCount {
        bytes nodeOperatorIds;
        bytes validatorsCounts;
        uint256 callCount;
    }

    Call_updateValidatorsCount public lastCall_updateStuckValidatorsCount;
    Call_updateValidatorsCount public lastCall_updateExitedValidatorsCount;

    function updateStuckValidatorsCount(
        bytes calldata _nodeOperatorIds,
        bytes calldata _stuckValidatorsCounts
    ) external {
        lastCall_updateStuckValidatorsCount.nodeOperatorIds = _nodeOperatorIds;
        lastCall_updateStuckValidatorsCount.validatorsCounts = _stuckValidatorsCounts;
        ++lastCall_updateStuckValidatorsCount.callCount;
    }

    function updateExitedValidatorsCount(
        bytes calldata _nodeOperatorIds,
        bytes calldata _exitedValidatorsCounts
    ) external {
        lastCall_updateExitedValidatorsCount.nodeOperatorIds = _nodeOperatorIds;
        lastCall_updateExitedValidatorsCount.validatorsCounts = _exitedValidatorsCounts;
        ++lastCall_updateExitedValidatorsCount.callCount;
    }

    function updateRefundedValidatorsCount(uint256 _nodeOperatorId, uint256 _refundedValidatorsCount) external {}

    uint256 public callCount_onExitedAndStuckValidatorsCountsUpdated;

    function onExitedAndStuckValidatorsCountsUpdated() external {
        ++callCount_onExitedAndStuckValidatorsCountsUpdated;
    }

    function unsafeUpdateValidatorsCount(
        uint256 /* _nodeOperatorId */,
        uint256 /* _exitedValidatorsKeysCount */,
        uint256 /* _stuckValidatorsKeysCount */
    ) external {}

    function onWithdrawalCredentialsChanged() external {
        _availableValidatorsCount = _activeValidatorsCount;
    }

    function obtainDepositData(uint256 _depositsCount, bytes calldata _calldata)
        external
        returns (
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        publicKeys = new bytes(48 * _depositsCount);
        signatures = new bytes(96 * _depositsCount);
    }

    function setTotalExitedValidatorsCount(uint256 newExitedValidatorsCount) external {
        _exitedValidatorsCount = newExitedValidatorsCount;
    }

    function setActiveValidatorsCount(uint256 _newActiveValidatorsCount) external {
        _activeValidatorsCount = _newActiveValidatorsCount;
    }

    function setAvailableKeysCount(uint256 _newAvailableValidatorsCount) external {
        _availableValidatorsCount = _newAvailableValidatorsCount;
    }
}
