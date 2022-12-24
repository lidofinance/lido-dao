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

    function getKeysOpIndex() external view returns (uint256) {}

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes calldata depositCalldata)
        external
        returns (
            uint256 keysCount,
            bytes memory pubkeys,
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
