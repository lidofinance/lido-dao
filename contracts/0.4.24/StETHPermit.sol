// SPDX-FileCopyrightText: 2023 OpenZeppelin, Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import {ECDSA} from "../common/lib/ECDSA.sol";
import {IEIP712} from "../common/interfaces/IEIP712.sol";

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

contract StETHPermit is IERC2612, StETH {
    /**
     * @dev Service event for initialization
     */
    event EIP712StETHInitialized(address eip712StETH);

    /**
     * @dev Nonces for ERC-2612 (Permit)
     */
    mapping(address => uint256) public nonces;

    /**
     * @dev EIP712 message utils contract for StETH
     */
    address public eip712StETH;

    /**
     * @dev Typehash constant for ERC-2612 (Permit)
     */
    // solhint-disable-next-line var-name-mixedcase
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

        bytes32 hash = IEIP712(eip712StETH).hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, _v, _r, _s);
        require(signer == _owner, "ERC20Permit: invalid signature");

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
        return nonces[owner];
    }

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return IEIP712(eip712StETH).domainSeparatorV4();
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     */
    function _useNonce(address _owner) internal returns (uint256 current) {
        current = nonces[_owner];
        nonces[_owner] = current.add(1);
    }

    /**
     * @dev Initialize EIP712 message utils contract for stETH
     */
    function _initializeEIP712StETH(address _eip712StETH) internal {
        require(_eip712StETH != address(0), "StETHPermit: zero eip712StETH");
        require(eip712StETH == address(0), "StETHPermit: eip712StETH already set");

        eip712StETH = _eip712StETH;

        emit EIP712StETHInitialized(_eip712StETH);
    }
}
