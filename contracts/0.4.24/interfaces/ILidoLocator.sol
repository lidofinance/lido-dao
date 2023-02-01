// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

interface ILidoLocator {
    function getELRewardsVault() external returns (address);
    function getWithdrawalVault() external returns (address);
    function getStakingRouter() external returns (address);
    function getOracle() external returns (address);
    function getTreasury() external returns (address);
    function getWithdrawalQueue() external returns (address);
    function getDepositSecurityModule() external returns (address);
    function getPostTokenRebaseReceiver() external returns (address);
    function getSelfOwnedStETHBurner() external returns (address);
    function getSafetyNetsRegistry() external returns (address);
}
