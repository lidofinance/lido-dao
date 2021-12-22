// SPDX-License-Identifier: GPL-3.0

// SPDX-License-Identifier: MIT

pragma solidity 0.4.24;


interface ILidoMevTxFeeVault {

    /**
    * @notice Withdraw all accumulated rewards to Lido contract
    * @return balance uint256 of funds received as MEV and transaction fees in wei
    */
    function withdrawRewards() external returns (uint256);
}
