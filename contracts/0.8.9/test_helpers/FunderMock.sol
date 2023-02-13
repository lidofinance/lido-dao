// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
//SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

contract FunderMock {
    function pay(address payable _target) external payable {
        selfdestruct(_target);
    }
}
