// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingModule} from "../interfaces/IStakingModule.sol";

contract StakingModuleMock is IStakingModule {
    uint256 private _totalKeys;
    uint256 private _totalUsedKeys;
    uint256 private _totalStoppedKeys;

    function getTotalKeys() external view returns (uint256) {
        return _totalKeys;
    }

    function getTotalUsedKeys() external view returns (uint256) {
        return _totalUsedKeys;
    }

    function getTotalStoppedKeys() external view returns (uint256) {
        return _totalStoppedKeys;
    }

    function getSigningKeysStats()
        external
        view
        returns (
            uint256 totalSigningKeys,
            uint256 usedSigningKeys,
            uint256 stoppedSigningKeys
        )
    {
        totalSigningKeys = _totalKeys;
        usedSigningKeys = _totalUsedKeys;
        stoppedSigningKeys = _totalStoppedKeys;
    }

    function getType() external view returns (bytes32) {}

    function trimUnusedKeys() external {}

    function getKeysOpIndex() external view returns (uint256) {}

    function setTotalKeys(uint256 _newTotalKeys) external {
        _totalKeys = _newTotalKeys;
    }

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes calldata depositCalldata)
        external
        returns (
            uint256 keysCount,
            bytes memory pubkeys,
            bytes memory signatures
        )
    {}

    function setTotalUsedKeys(uint256 _newTotalUsedKeys) external {
        _totalUsedKeys = _newTotalUsedKeys;
    }

    function setTotalStoppedKeys(uint256 _newTotalStoppedKeys) external {
        _totalStoppedKeys = _newTotalStoppedKeys;
    }
}
