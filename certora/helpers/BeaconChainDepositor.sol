// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import {BeaconChainDepositor} from "../munged/BeaconChainDepositor.sol";

contract BeaconChainDepositorHarness is BeaconChainDepositor {

    // Certora replacements for MemUtils
    mapping(bytes => bytes32) private _publicKeyRoot;
    mapping(bytes => bytes32) private _signatureRoot;
    mapping(bytes => mapping(uint256 => bytes)) private _publicKeyMap;
    mapping(bytes => mapping(uint256 => bytes)) private _signatureMap;

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {}

    /// @notice Certora: change root-hashing functions to simple mappings.
    /// @dev Invokes a deposit call to the official Beacon Deposit contract
    /// @param _keysCount amount of keys to deposit
    /// @param _withdrawalCredentials Commitment to a public key for withdrawals
    /// @param _publicKeysBatch A BLS12-381 public keys batch
    /// @param _signaturesBatch A BLS12-381 signatures batch
    function _makeBeaconChainDeposits32ETH(
        uint256 _keysCount,
        bytes memory _withdrawalCredentials,
        bytes memory _publicKeysBatch,
        bytes memory _signaturesBatch
    ) internal override {
        require(_publicKeysBatch.length == PUBLIC_KEY_LENGTH * _keysCount, "INVALID_PUBLIC_KEYS_BATCH_LENGTH");
        require(_signaturesBatch.length == SIGNATURE_LENGTH * _keysCount, "INVALID_SIGNATURES_BATCH_LENGTH");
        uint256 targetBalance = address(this).balance - (_keysCount * DEPOSIT_SIZE);

        bytes memory publicKey;
        bytes memory signature;

        for (uint256 i; i < _keysCount;) {
            publicKey = _publicKeyMap[_publicKeysBatch][i];
            signature = _signatureMap[_signaturesBatch][i];
            require(publicKey.length == PUBLIC_KEY_LENGTH);
            require(signature.length == SIGNATURE_LENGTH);
            
            DEPOSIT_CONTRACT.deposit{value: DEPOSIT_SIZE}(
                _publicKeysBatch, _withdrawalCredentials, signature,
                _computeDepositDataRootCertora(_withdrawalCredentials, publicKey, signature)
            );

            unchecked {
                ++i;
            }
        }

        if (address(this).balance != targetBalance) revert NotExpectedBalance();
    }

    /// @notice Certora: change root-hashing functions to simple mappings.
    /// @dev computes the deposit_root_hash required by official Beacon Deposit contract
    /// @param _publicKey A BLS12-381 public key.
    /// @param _signature A BLS12-381 signature
    function _computeDepositDataRootCertora(bytes memory _withdrawalCredentials, bytes memory _publicKey, bytes memory _signature)
        private
        view 
        returns (bytes32)
    {
        bytes32 publicKeyRoot = _publicKeyRoot[_publicKey];
        bytes32 signatureRoot = _signatureRoot[_signature];

        return sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(publicKeyRoot, _withdrawalCredentials)),
                sha256(abi.encodePacked(DEPOSIT_SIZE_IN_GWEI_LE64, bytes24(0), signatureRoot))
            )
        );
    }
}
