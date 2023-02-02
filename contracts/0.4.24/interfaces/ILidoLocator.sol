// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

interface ILidoLocator {
    function getELRewardsVault() external view returns (address);
    function getWithdrawalVault() external view returns (address);
    function getStakingRouter() external view returns (address);
    function getOracle() external view returns (address);
    function getTreasury() external view returns (address);
    function getWithdrawalQueue() external view returns (address);
    function getDepositSecurityModule() external view returns (address);
    function getPostTokenRebaseReceiver() external view returns (address);
    function getSelfOwnedStETHBurner() external view returns (address);
    function getSafetyNetsRegistry() external view returns (address);
}
