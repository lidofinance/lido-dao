// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12; // latest available for using OZ

import "../CstETH.sol";
import "../interfaces/ILido.sol";


contract CstETHMock is CstETH {
    constructor(ILido _lido, IERC20 _stETH) public CstETH(_lido, _stETH) {}

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
