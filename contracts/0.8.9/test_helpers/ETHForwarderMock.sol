// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

//SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

contract ETHForwarderMock {
    constructor(address payable _target) payable {
        selfdestruct(_target);
    }
}
