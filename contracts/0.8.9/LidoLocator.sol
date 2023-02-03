// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {ILidoLocator} from "../common/interfaces/ILidoLocator.sol";

/**
 * @title LidoLocator
 * @author mymphe
 * @notice Lido service locator
 * @dev configuration is stored as public immutables to reduce gas consumption
 */
contract LidoLocator is ILidoLocator {
    struct Config {
        address accountingOracle;
        address depositSecurityModule;
        address elRewardsVault;
        address legacyOracle;
        address lido;
        address safetyNetsRegistry;
        address selfOwnedStEthBurner;
        address stakingRouter;
        address treasury;
        address validatorExitBus;
        address withdrawalQueue;
        address withdrawalVault;
    }

    error ErrorZeroAddress();

    address public immutable accountingOracle;
    address public immutable depositSecurityModule;
    address public immutable elRewardsVault;
    address public immutable legacyOracle;
    address public immutable lido;
    address public immutable safetyNetsRegistry;
    address public immutable selfOwnedStEthBurner;
    address public immutable stakingRouter;
    address public immutable treasury;
    address public immutable validatorExitBus;
    address public immutable withdrawalQueue;
    address public immutable withdrawalVault;

    /**
     * @notice declare service locations
     * @dev accepts a struct to avoid the "stack-too-deep" error
     * @param _config struct of addresses
     */
    constructor(Config memory _config) {
        if (_config.accountingOracle == address(0)) revert ErrorZeroAddress();
        if (_config.depositSecurityModule == address(0)) revert ErrorZeroAddress();
        if (_config.elRewardsVault == address(0)) revert ErrorZeroAddress();
        if (_config.legacyOracle == address(0)) revert ErrorZeroAddress();
        if (_config.lido == address(0)) revert ErrorZeroAddress();
        if (_config.safetyNetsRegistry == address(0)) revert ErrorZeroAddress();
        if (_config.selfOwnedStEthBurner == address(0)) revert ErrorZeroAddress();
        if (_config.stakingRouter == address(0)) revert ErrorZeroAddress();
        if (_config.treasury == address(0)) revert ErrorZeroAddress();
        if (_config.validatorExitBus == address(0)) revert ErrorZeroAddress();
        if (_config.withdrawalQueue == address(0)) revert ErrorZeroAddress();
        if (_config.withdrawalVault == address(0)) revert ErrorZeroAddress();

        accountingOracle = _config.accountingOracle;
        depositSecurityModule = _config.depositSecurityModule;
        elRewardsVault = _config.elRewardsVault;
        legacyOracle = _config.legacyOracle;
        lido = _config.lido;
        safetyNetsRegistry = _config.safetyNetsRegistry;
        selfOwnedStEthBurner = _config.selfOwnedStEthBurner;
        stakingRouter = _config.stakingRouter;
        treasury = _config.treasury;
        validatorExitBus = _config.validatorExitBus;
        withdrawalQueue = _config.withdrawalQueue;
        withdrawalVault = _config.withdrawalVault;
    }
}
