// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20OZMock is ERC20 {
    constructor(uint256 initialSupply) public ERC20("Mock ERC20 token", "mTKN") {
        _mint(msg.sender, initialSupply);
    }
}