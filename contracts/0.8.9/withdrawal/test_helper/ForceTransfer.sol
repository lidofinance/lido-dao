// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

contract ForceTransfer {
  constructor(address payable receiver) payable {
    selfdestruct(receiver);
  }
}
