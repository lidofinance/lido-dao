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
        address withdrawalRequestNFT,
        address withdrawalVault
    );
}

contract MockLidoLocatorForOracles is ILidoLocator {
    address public immutable lido;
    address public immutable stakingRouter;
    address public immutable withdrawalRequestNFT;
    address public immutable oracleReportSanityChecker;

    constructor(
        address _lido,
        address _stakingRouter,
        address _withdrawalRequestNFT,
        address _oracleReportSanityChecker
    ) {
        lido = _lido;
        stakingRouter = _stakingRouter;
        withdrawalRequestNFT = _withdrawalRequestNFT;
        oracleReportSanityChecker = _oracleReportSanityChecker;
    }

    function coreComponents() external view returns (
        address elRewardsVault_,
        address oracleReportSanityChecker_,
        address stakingRouter_,
        address treasury_,
        address withdrawalRequestNFT_,
        address withdrawalVault_
    ) {
        oracleReportSanityChecker_ = oracleReportSanityChecker;
        stakingRouter_ = stakingRouter;
        withdrawalRequestNFT_ = withdrawalRequestNFT;
    }
}
