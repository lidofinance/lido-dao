// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

interface IStETH {
    function sharesOf(address _account) external view returns (uint256);

    function transferShares(address _recipient, uint256 _sharesAmount) external returns (uint256);
}
