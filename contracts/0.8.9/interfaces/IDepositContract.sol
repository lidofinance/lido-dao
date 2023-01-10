// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/**
 * @title Deposit contract interface
 */
interface IDepositContract {
    function get_deposit_root() external view returns (bytes32 rootHash);

    /**
     * @notice Top-ups deposit of a validator on the ETH 2.0 side
     * @param pubkey Validator signing key
     * @param withdrawal_credentials Credentials that allows to withdraw funds
     * @param signature Signature of the request
     * @param deposit_data_root The deposits Merkle tree node, used as a checksum
     */
    function deposit(
        bytes /* 48 */
            calldata pubkey,
        bytes /* 32 */
            calldata withdrawal_credentials,
        bytes /* 96 */
            calldata signature,
        bytes32 deposit_data_root
    ) external payable;
}
