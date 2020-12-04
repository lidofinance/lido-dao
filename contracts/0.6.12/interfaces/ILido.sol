// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12; // latest available for using OZ

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILido is IERC20 {
    function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256);
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
}
