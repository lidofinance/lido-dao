// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


import "../lib/UnstructuredStorage.sol";


contract Versioned {
    using UnstructuredStorage for bytes32;

    event ContractVersionSet(uint256 version);

    /// @dev Storage slot: uint256 version
    /// Version of the initialized contract storage.
    /// The version stored in CONTRACT_VERSION_POSITION equals to:
    /// - 0 right after the deployment, before an initializer is invoked (and only at that moment);
    /// - N after calling initialize(), where N is the initially deployed contract version;
    /// - N after upgrading contract by calling finalizeUpgrade_vN().
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.Versioned.contractVersion");

    constructor() {
        // lock version in the implementation's storage to prevent initialization
        CONTRACT_VERSION_POSITION.setStorageUint256(2**256 - 1);
    }

    /// @notice Returns the current contract version.
    function getVersion() external view returns (uint256) {
        return _getContractVersion();
    }

    /// @notice Returns the current contract version.
    function getContractVersion() external view returns (uint256) {
        return _getContractVersion();
    }

    function _getContractVersion() internal view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    function _checkContractVersion(uint256 expectedVersion) internal view {
        require(expectedVersion == _getContractVersion(), "UNEXPECTED_CONTRACT_VERSION");
    }

    /// @dev Sets the contract version to 1. Should be called from the initialize() function.
    function _initializeContractVersionTo1() internal {
        require(_getContractVersion() == 0, "NON_ZERO_CONTRACT_VERSION_ON_INIT");
        _writeContractVersion(1);
    }

    /// @dev Updates the contract version. Should be called from a finalizeUpgrade_vN() function.
    function _updateContractVersion(uint256 newVersion) internal {
        require(newVersion == _getContractVersion() + 1, "INVALID_CONTRACT_VERSION_INCREMENT");
        _writeContractVersion(newVersion);
    }

    function _writeContractVersion(uint256 version) internal {
        CONTRACT_VERSION_POSITION.setStorageUint256(version);
        emit ContractVersionSet(version);
    }
}
