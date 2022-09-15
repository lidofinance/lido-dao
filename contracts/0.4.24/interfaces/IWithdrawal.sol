// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


interface IWithdrawal {
  function request(address _from, uint256 _stethAmount, uint256 _sharesAmount) external returns (uint256);
  function cashout(address _to, uint256 _ticketId) external;
}
