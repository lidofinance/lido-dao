// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { IComponentLocator } from "../../oracle/AccountingOracle.sol";


contract MockLidoLocatorForOracles is IComponentLocator {
    address public immutable lido;
    address public immutable stakingRouter;
    address public immutable withdrawalQueue;
    address public immutable safetyNetsRegistry;

    constructor(
        address _lido,
        address _stakingRouter,
        address _withdrawalQueue,
        address _safetyNetsRegistry
    ) {
        lido = _lido;
        stakingRouter = _stakingRouter;
        withdrawalQueue = _withdrawalQueue;
        safetyNetsRegistry = _safetyNetsRegistry;
    }

    function coreComponents() external view returns (
        address elRewardsVault_,
        address safetyNetsRegistry_,
        address stakingRouter_,
        address treasury_,
        address withdrawalQueue_,
        address withdrawalVault_
    ) {
        safetyNetsRegistry_ = safetyNetsRegistry;
        stakingRouter_ = stakingRouter;
        withdrawalQueue_ = withdrawalQueue;
    }
}
