// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

interface IStakingRouter {
    function calculateShares2Mint(uint256 _totalRewards) external returns(uint256 shares2mint, uint256 totalKeys, uint256[] memory moduleKeys);
    function distributeShares(uint256 _totalShares, uint256 totalKeys, uint256[] moduleKeys) external returns(uint256 distributed);
    function trimUnusedKeys() external;
    function deposit(bytes pubkeys, bytes signatures) external returns(uint);
}