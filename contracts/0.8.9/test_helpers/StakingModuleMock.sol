// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingModule} from "../interfaces/IStakingModule.sol";

contract StakingModuleMock is IStakingModule {
    uint256 private _activeKeysCount;
    uint256 private _availableKeysCount;

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
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {}

    function getValidatorsKeysNonce() external view returns (uint256) {}

    function getNodeOperatorsCount() external view returns (uint24) {}

    function getActiveNodeOperatorsCount() external view returns (uint24) {}

    function getNodeOperatorIsActive(uint24 _nodeOperatorId) external view returns (bool) {}

    function getNodeOperatorValidatorsKeysStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {}

    function updateNodeOperatorExitedValidatorsKeysCount(uint24 _nodeOperatorId, uint64 _exitedValidatorsCount) external {}

    function trimUnusedValidatorsKeys() external {}

    function enqueueApprovedValidatorsKeys(uint64 _keysCount, bytes calldata _calldata)
        external
        returns (
            uint64 enqueuedValidatorsKeysCount,
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
