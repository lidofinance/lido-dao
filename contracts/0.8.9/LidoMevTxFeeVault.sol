// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT


pragma solidity 0.8.9;

interface ILido {
    function mevReceiver() external payable;
}

contract LidoMevTxFeeVault {
    address public immutable lidoAddress;

    constructor(address _lidoAddress) {
        lidoAddress = _lidoAddress;
    }

    /**
    * @notice Withdraw all accumulated rewards to Lido contract
    * @return balance uint256 of funds received as MEV and Transaction fees in wei
    */
    function withdrawRewards() external returns (uint256 balance) {
        require(msg.sender == lidoAddress, "Nobody except Lido contract can withdraw");

        balance = address(this).balance;
        if (balance > 0) {
            ILido(lidoAddress).mevReceiver{value: balance}();
        }
        return balance;
    }
}