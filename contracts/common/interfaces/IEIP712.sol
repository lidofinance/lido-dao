// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity 0.4.24||0.8.9;

/**
 * @dev Helper interface of EIP712.
 *
 * Has an access to the CHAIN_ID opcode and relies on immutables internally
 * Both are unavailable for Solidity 0.4.24.
 */
interface IEIP712 {
    /**
     * @dev Returns the domain separator for the current chain.
     */
    function domainSeparatorV4() external view returns (bytes32);

    /**
     * @dev Given an already https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct[hashed struct], this
     * function returns the hash of the fully encoded EIP712 message for this domain.
     *
     * This hash can be used together with {ECDSA-recover} to obtain the signer of a message. For example:
     *
     * ```solidity
     * bytes32 digest = hashTypedDataV4(keccak256(abi.encode(
     *     keccak256("Mail(address to,string contents)"),
     *     mailTo,
     *     keccak256(bytes(mailContents))
     * )));
     * address signer = ECDSA.recover(digest, signature);
     * ```
     */
    function hashTypedDataV4(bytes32 _structHash) external view returns (bytes32);
}
