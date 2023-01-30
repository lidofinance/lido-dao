// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import {BytesLib} from "./lib/BytesLib.sol";

import {IDepositContract} from "./interfaces/IDepositContract.sol";

contract BeaconChainDepositor {
    uint256 internal constant PUBLIC_KEY_LENGTH = 48;
    uint256 internal constant SIGNATURE_LENGTH = 96;
    uint256 internal constant DEPOSIT_SIZE = 32 ether;

    /// @dev deposit amount 32eth in gweis converted to little endian uint64
    /// DEPOSIT_SIZE_IN_GWEI_LE64 = toLittleEndian64(32 ether / 1 gwei)
    uint64 internal constant DEPOSIT_SIZE_IN_GWEI_LE64 = 0x0040597307000000;

    IDepositContract public immutable DEPOSIT_CONTRACT;

    constructor(address _depositContract) {
        if (_depositContract == address(0)) revert ErrorDepositContractZeroAddress();
        DEPOSIT_CONTRACT = IDepositContract(_depositContract);
    }

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
    ) internal {
        require(_publicKeysBatch.length == PUBLIC_KEY_LENGTH * _keysCount, "INVALID_PUBLIC_KEYS_BATCH_LENGTH");
        require(_signaturesBatch.length == SIGNATURE_LENGTH * _keysCount, "INVALID_SIGNATURES_BATCH_LENGTH");

        uint256 targetBalance = address(this).balance - (_keysCount * DEPOSIT_SIZE);

        bytes memory publicKey;
        bytes memory signature;
        for (uint256 i; i < _keysCount; ) {
            publicKey = BytesLib.slice(_publicKeysBatch, i * PUBLIC_KEY_LENGTH, PUBLIC_KEY_LENGTH);
            signature = BytesLib.slice(_signaturesBatch, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            DEPOSIT_CONTRACT.deposit{value: DEPOSIT_SIZE}(
                publicKey,
                _withdrawalCredentials,
                signature,
                _computeDepositDataRoot(_withdrawalCredentials, publicKey, signature)
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
    function _computeDepositDataRoot(
        bytes memory _withdrawalCredentials,
        bytes memory _publicKey,
        bytes memory _signature
    ) private pure returns (bytes32) {
        // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
        bytes32 publicKeyRoot = sha256(_pad64(_publicKey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64)))
            )
        );

        return
            sha256(
                abi.encodePacked(
                    sha256(abi.encodePacked(publicKeyRoot, _withdrawalCredentials)),
                    sha256(abi.encodePacked(DEPOSIT_SIZE_IN_GWEI_LE64, bytes24(0), signatureRoot))
                )
            );
    }

    /// @dev Padding memory array with zeroes up to 64 bytes on the right
    /// @param _b Memory array of size 32 .. 64
    function _pad64(bytes memory _b) internal pure returns (bytes memory) {
        assert(_b.length >= 32 && _b.length <= 64);
        if (64 == _b.length) return _b;

        bytes memory zero32 = new bytes(32);
        assembly {
            mstore(add(zero32, 0x20), 0)
        }

        if (32 == _b.length) return BytesLib.concat(_b, zero32);
        else return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64) - _b.length));
    }

    error ErrorDepositContractZeroAddress();
    error ErrorNotExpectedBalance();
}
