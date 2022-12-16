// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

interface IStETH {
    function sharesOf(address _account) public view returns (uint256);

    function transferShares(address _recipient, uint256 _sharesAmount) public returns (uint256);
}
