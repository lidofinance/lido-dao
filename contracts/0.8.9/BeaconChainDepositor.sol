// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>2
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import {BytesLib} from "./lib/BytesLib.sol";

import {IDepositContract} from "./interfaces/IDepositContract.sol";

contract BeaconChainDepositor {
    uint256 private constant SIGNATURE_LENGTH = 96;
    uint256 private constant DEPOSIT_AMOUNT_UNIT = 1 gwei;

    IDepositContract public immutable DEPOSIT_CONTRACT;

    constructor(address _depositContract) {
        if (_depositContract == address(0)) revert ErrorDepositContractZeroAddress();
        DEPOSIT_CONTRACT = IDepositContract(_depositContract);
    }

    /// @dev Invokes a deposit call to the official Beacon Deposit contract
    /// @param _withdrawalCredentials Commitment to a public key for withdrawals
    /// @param _publicKey A BLS12-381 public key.
    /// @param _signature A BLS12-381 signature
    /// @param _depositValue Amount of ETH to deposit into Beacon Deposit contract in Wei
    function _makeBeaconChainDeposit(
        bytes memory _withdrawalCredentials,
        bytes memory _publicKey,
        bytes memory _signature,
        uint256 _depositValue
    ) internal {
        uint256 targetBalance = address(this).balance - _depositValue;
        DEPOSIT_CONTRACT.deposit{value: _depositValue}(
            _publicKey,
            _withdrawalCredentials,
            _signature,
            _computeDepositDataRoot(_withdrawalCredentials, _publicKey, _signature, _depositValue / DEPOSIT_AMOUNT_UNIT)
        );

        if (address(this).balance != targetBalance) revert ErrorNotExpectedBalance();
    }

    /// @dev computes the deposit_root_hash required by official Beacon Deposit contract
    /// @param _publicKey A BLS12-381 public key.
    /// @param _signature A BLS12-381 signature
    /// @param _depositAmount Amount of ETH to deposit into Beacon Deposit contract in Deposit Contract units
    function _computeDepositDataRoot(
        bytes memory _withdrawalCredentials,
        bytes memory _publicKey,
        bytes memory _signature,
        uint256 _depositAmount
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
                    sha256(abi.encodePacked(_toLittleEndian64(_depositAmount), signatureRoot))
                )
            );
    }

    /// @dev Padding memory array with zeroes up to 64 bytes on the right
    /// @param _b Memory array of size 32 .. 64
    function _pad64(bytes memory _b) private pure returns (bytes memory) {
        assert(_b.length >= 32 && _b.length <= 64);
        if (64 == _b.length) return _b;

        bytes memory zero32 = new bytes(32);
        assembly {
            mstore(add(zero32, 0x20), 0)
        }

        if (32 == _b.length) return BytesLib.concat(_b, zero32);
        else return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64) - _b.length));
    }

    /// @dev Converting value to little endian bytes and padding up to 32 bytes on the right
    /// @param _value Number less than `2**64` for compatibility reasons
    function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
        result = 0;
        uint256 temp_value = _value;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (temp_value & 0xFF);
            temp_value >>= 8;
        }

        assert(0 == temp_value); // fully converted
        result <<= (24 * 8);
    }

    error ErrorDepositContractZeroAddress();
    error ErrorNotExpectedBalance();
}
