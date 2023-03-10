// SPDX-FileCopyrightText: 2023 OpenZeppelin, Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";
import {Address} from "openzeppelin-solidity/contracts/utils/Address.sol";

import {ECDSA} from "../common/lib/ECDSA.sol";
import {IEIP712StETH} from "../common/interfaces/IEIP712StETH.sol";

import {StETH} from "./StETH.sol";

/**
 * @dev Interface of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on {IERC20-approve}, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 */
interface IERC2612 {
    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     */
    function permit(
        address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external;

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256);

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}


/**
 * @dev Standard Signature Validation Method for Contracts, as defined in https://eips.ethereum.org/EIPS/eip-1271.
 */
interface IERC1271 {
  /**
   * @dev Should return whether the signature provided is valid for the provided hash.
   *
   * @param _hash Hash of the data to be signed.
   * @param _signature Signature byte array associated with `_hash`.
   *
   * - MUST return the bytes4 magic value `0x1626ba7e` which is the function's selector,
   *   `bytes4(keccak256("isValidSignature(bytes32,bytes)")`, when function passes.
   * - MUST NOT modify state (using STATICCALL for solc < 0.5, view modifier for solc > 0.5).
   * - MUST allow external calls.
   */
  function isValidSignature(bytes32 _hash, bytes _signature) external view returns (bytes4);
}


contract StETHPermit is IERC2612, StETH {
    using UnstructuredStorage for bytes32;

    /**
     * @dev Service event for initialization
     */
    event EIP712StETHInitialized(address eip712StETH);

    /**
     * @dev Nonces for ERC-2612 (Permit)
     */
    mapping(address => uint256) internal noncesByAddress;

    /**
     * @dev Storage position used for the EIP712 message utils contract
     */
    bytes32 internal constant EIP712_STETH_POSITION = keccak256("lido.StETHPermit.eip712StETH");

    /**
     * @dev Typehash constant for ERC-2612 (Permit)
     */
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     */
    function permit(
        address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s
    ) external {
        require(block.timestamp <= _deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, _owner, _spender, _value, _useNonce(_owner), _deadline)
        );

        bytes32 hash = IEIP712StETH(getEIP712StETH()).hashTypedDataV4(address(this), structHash);

        require(_isValidSignature(_owner, hash, _v, _r, _s), "invalid signature");
        _approve(_owner, _spender, _value);
    }

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256) {
        return noncesByAddress[owner];
    }

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return IEIP712StETH(getEIP712StETH()).domainSeparatorV4(address(this));
    }

    /**
     * @dev returns the fields and values that describe the domain separator used by this contract for EIP-712
     * signature.
     *
     * NB: compairing to the full-fledged ERC-5267 version:
     * - `salt` and `extensions` are unused
     * - `flags` is hex"0f" or 01111b
     *
     * @dev using shortened returns to reduce a bytecode size
     */
    function eip712Domain() external view returns (
        string memory name,
        string memory version,
        uint256 chainId,
        address verifyingContract
    ) {
        return IEIP712StETH(getEIP712StETH()).eip712Domain(address(this));
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     */
    function _useNonce(address _owner) internal returns (uint256 current) {
        current = noncesByAddress[_owner];
        noncesByAddress[_owner] = current.add(1);
    }

    /**
     * @dev Initialize EIP712 message utils contract for stETH
     */
    function _initializeEIP712StETH(address _eip712StETH) internal {
        require(_eip712StETH != address(0), "StETHPermit: zero eip712StETH");
        require(getEIP712StETH() == address(0), "StETHPermit: eip712StETH already set");

        EIP712_STETH_POSITION.setStorageAddress(_eip712StETH);

        emit EIP712StETHInitialized(_eip712StETH);
    }

    /**
     * @dev Get EIP712 message utils contract
     */
    function getEIP712StETH() public view returns (address) {
        return EIP712_STETH_POSITION.getStorageAddress();
    }

    /**
     * @dev Checks signature validity.
     *
     * If the signer address doesn't contain any code, assumes that the address is externally owned
     * and the signature is a ECDSA signature generated using its private key. Otherwise, issues a
     * static call to the signer address to check the signature validity using the ERC-1271 standard.
     */
    function _isValidSignature(
        address _signer,
        bytes32 _msgHash,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal returns (bool) {
        if (Address.isContract(_signer)) {
            bytes memory sig = abi.encodePacked(_r, _s, _v);
            // Solidity <0.5 generates a regular CALL instruction even if the function being called
            // is marked as `view`, and the only way to perform a STATICCALL is to use assembly
            bytes memory data = abi.encodeWithSelector(IERC1271(0).isValidSignature.selector, _msgHash, sig);
            bytes4 retval;
            assembly {
                // allocate memory for storing the return value
                let outDataOffset := mload(0x40)
                mstore(0x40, add(outDataOffset, 32))
                // issue a static call and load the result if the call succeeded
                let success := staticcall(gas(), _signer, add(data, 32), mload(data), outDataOffset, 4)
                if eq(success, 1) {
                    retval := mload(outDataOffset)
                }
            }
            return retval == IERC1271(0).isValidSignature.selector;
        } else {
            return ECDSA.recover(_msgHash, _v, _r, _s) == _signer;
        }
    }
}
