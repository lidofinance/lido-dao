// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {ERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/ERC20.sol";

contract ERC20Token__MockForWithdrawalVault is ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {}

    function mint(address _to, uint256 _amount) external {
        super._mint(_to, _amount);
    }
}
