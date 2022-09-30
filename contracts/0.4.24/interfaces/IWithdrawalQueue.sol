// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


interface IWithdrawalQueue {
  function createTicket(address _from, uint256 _maxETHToWithdraw, uint256 _sharesToBurn) external returns (uint256);
  function withdraw(uint256 _ticketId) external;
  function queue(uint256 _ticketId) external view returns (address, uint, uint);
  function finalizedQueueLength() external view returns (uint);
}
