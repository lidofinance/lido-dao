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

    function getValidatorsKeysStats()
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {
        exitedValidatorsCount = 0;
        activeValidatorsKeysCount = _activeKeysCount;
        readyToDepositValidatorsKeysCount = _availableKeysCount;
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

    function getValidatorsKeysStats(uint256 _nodeOperatorId)
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {}

    function handleRewardsMinted(uint256 _totalShares) external {}

    function updateExitedValidatorsKeysCount(uint256, uint256) external returns (uint256) {
        return 0;
    }

    function finishUpdatingExitedValidatorsKeysCount() external {}

    function unsafeUpdateExitedValidatorsKeysCount(
        uint256 /* _nodeOperatorId */,
        uint256 /* _exitedValidatorsKeysCount */
    ) external returns (uint256)
    {
        return 0;
    }

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
