// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12; // latest available for using OZ

import "../WstETH.sol";
import "../interfaces/IStETH.sol";


contract WstETHMock is WstETH {
    constructor(IStETH _stETH) public WstETH(_stETH) {}

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
