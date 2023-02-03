// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity 0.4.24||0.8.9;

interface ILidoLocator {
    function getLido() external pure returns(address);
    function getDepositSecurityModule() external pure returns (address);
    function getELRewardsVault() external pure returns (address);
    function getOracle() external pure returns (address);
    function getCompositePostRebaseBeaconReceiver() external pure returns (address);
    function getSafetyNetsRegistry() external pure returns (address);
    function getSelfOwnedStETHBurner() external pure returns (address);
    function getStakingRouter() external pure returns (address);
    function getTreasury() external pure returns (address);
    function getWithdrawalQueue() external pure returns (address);
    function getWithdrawalVault() external pure returns (address);
}