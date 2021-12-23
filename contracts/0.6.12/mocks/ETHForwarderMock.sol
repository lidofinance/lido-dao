// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

contract ETHForwarderMock {
    constructor(address payable target) public payable {
        selfdestruct(target);
    }
}