// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


interface ILidoMevTxFeeVault {

    /**
    * @notice Withdraw all accumulated rewards to Lido contract
    * @return amount uint256 of funds received as MEV and transaction fees in wei
    */
    function withdrawRewards() external returns (uint256 amount);
}
