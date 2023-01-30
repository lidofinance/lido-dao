// SPDX-FileCopyrightText: 2023 OpenZeppelin, Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import {ECDSA} from "../common/lib/ECDSA.sol";
import {IERC2612} from "./interfaces/IERC2612.sol";
import {IEIP712} from "../common/interfaces/IEIP712.sol";

import {StETH} from "./StETH.sol";

contract StETHPermit is IERC2612, StETH {
    /**
     * @dev Service event for initialization
     */
    event EIP712StETHInitialized(address eip712StETH);

    /**
     * @dev Nonces for ERC-2612 (Permit)
     */
    mapping(address => uint256) internal noncesByAddress;

    /**
     * @dev EIP712 message utils contract for StETH
     */
    address internal eip712StETH;

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
        return noncesByAddress[owner];
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
        current = noncesByAddress[_owner];
        noncesByAddress[_owner] = current.add(1);
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
