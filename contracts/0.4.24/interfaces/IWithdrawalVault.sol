// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * @notice interface for WithdrawalVault to use in Lido contract
 */
interface IWithdrawalVault {
    function withdrawWithdrawals(uint256 _amount) external;
}
