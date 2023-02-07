// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import {BeaconChainDepositor} from "../munged/BeaconChainDepositor.sol";

contract BeaconChainDepositorHarness is BeaconChainDepositor {

    mapping(bytes => bytes32) private _publicKeyRoot;
    mapping(bytes => bytes32) private _signatureRoot;
    uint256 private constant PUBLIC_KEY_LENGTH_2 = 64;

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {}

    /// @notice Certora implementation : avoiding using MemUtils library
    /// Assuming the public key length is 64 bytes and not 48 bytes.
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
        require(_publicKeysBatch.length == PUBLIC_KEY_LENGTH_2 * _keysCount, "INVALID_PUBLIC_KEYS_BATCH_LENGTH");
        require(_signaturesBatch.length == SIGNATURE_LENGTH * _keysCount, "INVALID_SIGNATURES_BATCH_LENGTH");
        uint256 targetBalance = address(this).balance - (_keysCount * DEPOSIT_SIZE);

        bytes memory publicKey;
        bytes memory signature;

        for (uint256 i; i < _keysCount;) {
            uint256 offsetKey = i * PUBLIC_KEY_LENGTH_2;
            uint256 offsetSignature = i * SIGNATURE_LENGTH;

            // Here it is assumed that the publicKeysBatch is two word aligned
            publicKey = abi.encodePacked(
                readWordAtOffset(_publicKeysBatch, offsetKey),
                readWordAtOffset(_publicKeysBatch, offsetKey + 32));

            signature = abi.encodePacked(
                readWordAtOffset(_publicKeysBatch, offsetSignature),
                readWordAtOffset(_publicKeysBatch, offsetSignature + 32),
                readWordAtOffset(_publicKeysBatch, offsetSignature + 64));

            DEPOSIT_CONTRACT.deposit{value: DEPOSIT_SIZE}(
                publicKey, _withdrawalCredentials, signature,
                _computeDepositDataRootCertora(_withdrawalCredentials, publicKey, signature)
            );

            unchecked {
                ++i;
            }
        }

        if (address(this).balance != targetBalance) revert ErrorNotExpectedBalance();
    }

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

    /**
    * @notice Certora helper: get a single word out of bytes at some offset.   
    * @param self The byte string to read a word from.
    * @param offset the offset to read the word at.
    * @return word The bytes32 word at the offset.
    */ 
    function readWordAtOffset(bytes memory self, uint256 offset) private pure returns(bytes32 word) {
        assembly {
            word := mload(add(add(self, 32), offset))
        }
    }
}