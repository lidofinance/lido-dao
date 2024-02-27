// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

contract Receiver__MockForWithdrawalQueueBase {

  bool public canReceive;

  function setCanReceive(bool _value) external {
    canReceive = _value;
  }

  receive() external payable {
    if (!canReceive) {
      revert("RECEIVER_NOT_ACCEPT_TOKENS");
    }
  }
}