// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;


interface ILido {
    /**
      * @notice Gets the amount of Ether temporary buffered on this contract balance
      */
    function getBufferedEther() external view returns (uint256);

    function getStakingRouter() external view returns (address);

    function receiveStakingRouter() external payable;
}
