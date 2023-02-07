// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


interface ILidoLocator {
    function lido() external view returns (address);
    function stakingRouter() external view returns (address);
    function coreComponents() external view returns (
        address elRewardsVault,
        address safetyNetsRegistry,
        address stakingRouter,
        address treasury,
        address withdrawalQueue,
        address withdrawalVault
    );
}

contract MockLidoLocatorForOracles is ILidoLocator {
    address public immutable lido;
    address public immutable stakingRouter;
    address public immutable withdrawalQueue;
    address public immutable oracleReportSanityChecker;

    constructor(
        address _lido,
        address _stakingRouter,
        address _withdrawalQueue,
        address _oracleReportSanityChecker
    ) {
        lido = _lido;
        stakingRouter = _stakingRouter;
        withdrawalQueue = _withdrawalQueue;
        oracleReportSanityChecker = _oracleReportSanityChecker;
    }

    function coreComponents() external view returns (
        address elRewardsVault_,
        address oracleReportSanityChecker_,
        address stakingRouter_,
        address treasury_,
        address withdrawalQueue_,
        address withdrawalVault_
    ) {
        oracleReportSanityChecker_ = oracleReportSanityChecker;
        stakingRouter_ = stakingRouter;
        withdrawalQueue_ = withdrawalQueue;
    }
}
