// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12; // latest available for using OZ

import "../WstETH.sol";
import "../interfaces/ILido.sol";


contract WstETHMock is WstETH {
    constructor(ILido _Lido) public WstETH(_Lido) {}

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
