// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


contract StakingModuleMock {
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

    function setTotalKeys(uint256 _newTotalKeys) external {
        _totalKeys = _newTotalKeys;
    }

    function setTotalUsedKeys(uint256 _newTotalUsedKeys) external {
        _totalUsedKeys = _newTotalUsedKeys;
    }

    function setTotalStoppedKeys(uint256 _newTotalStoppedKeys) external {
        _totalStoppedKeys = _newTotalStoppedKeys;
    }
}
