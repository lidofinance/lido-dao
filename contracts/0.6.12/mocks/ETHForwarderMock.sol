//SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

contract ETHForwarderMock {
    constructor(address payable target) public payable {
        selfdestruct(target);
    }
}