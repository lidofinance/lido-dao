// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingModule} from "../interfaces/IStakingModule.sol";

contract StakingModuleMock is IStakingModule {
    uint256 private _activeKeysCount;
    uint256 private _availableKeysCount;
    uint256 private _keysNonce;

    function getActiveKeysCount() public view returns (uint256) {
        return _activeKeysCount;
    }

    function getAvailableKeysCount() public view returns (uint256) {
        return _availableKeysCount;
    }

    function getKeysUsageData() external view returns (uint256 activeKeysCount, uint256 availableKeysCount) {
        activeKeysCount = getActiveKeysCount();
        availableKeysCount = getAvailableKeysCount();
    }

    function getType() external view returns (bytes32) {}

    function trimUnusedKeys() external {}

    function getValidatorsReport() external view returns (ValidatorsReport memory report) {
        report.totalDeposited = _activeKeysCount;
        report.totalVetted = _activeKeysCount + _availableKeysCount;
    }

    function getValidatorsReport(uint256 _nodeOperatorId) external view returns (ValidatorsReport memory report) {
    }

    function getValidatorsKeysNonce() external view returns (uint256) {
        return _keysNonce;
    }

    function setValidatorsKeysNonce(uint256 _newKeysNonce) external {
        _keysNonce = _newKeysNonce;
    }

    function getNodeOperatorsCount() external view returns (uint256) {}

    function getActiveNodeOperatorsCount() external view returns (uint256) {}

    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool) {}

    function handleRewardsMinted(uint256 _totalShares) external {}

    function updateStuckValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _stuckValidatorKeysCount
    ) external {}

    function updateExitedValidatorsKeysCount(uint256, uint256) external returns (uint256) {
        return 0;
    }

    function finishUpdatingExitedValidatorsKeysCount() external {}

    function unsafeUpdateValidatorsKeysCount(
        uint256 /* _nodeOperatorId */,
        uint256 /* _exitedValidatorsKeysCount */,
        uint256 /* _stuckValidatorsKeysCount */
    ) external {}

    function invalidateReadyToDepositKeys() external {
        _availableKeysCount = _activeKeysCount;
    }

    function requestValidatorsKeysForDeposits(uint256 _keysCount, bytes calldata _calldata)
        external
        returns (
            uint256 enqueuedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {}

    function setActiveKeysCount(uint256 _newActiveKeysCount) external {
        _activeKeysCount = _newActiveKeysCount;
    }

    function setAvailableKeysCount(uint256 _newAvailableKeysCount) external {
        _availableKeysCount = _newAvailableKeysCount;
    }
}
