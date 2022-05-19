// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


interface ILidoExecutionLayerRewardsVault {

    /**
    * @notice Withdraw all accumulated execution layer rewards to Lido contract
    * @param _maxAmount Max amount of ETH to withdraw
    * @return amount of funds received as execution layer rewards (in wei)
    */
    function withdrawRewards(uint256 _maxAmount) external returns (uint256 amount);
}
