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
        address postTokenRebaseReceiver;
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
    address public immutable postTokenRebaseReceiver;

    /**
     * @notice declare service locations
     * @dev accepts a struct to avoid the "stack-too-deep" error
     * @param _config struct of addresses
     */
    constructor(Config memory _config) {
        accountingOracle = _assertNonZero(_config.accountingOracle);
        depositSecurityModule = _assertNonZero(_config.depositSecurityModule);
        elRewardsVault = _assertNonZero(_config.elRewardsVault);
        legacyOracle = _assertNonZero(_config.legacyOracle);
        lido = _assertNonZero(_config.lido);
        safetyNetsRegistry = _assertNonZero(_config.safetyNetsRegistry);
        selfOwnedStEthBurner = _assertNonZero(_config.selfOwnedStEthBurner);
        stakingRouter = _assertNonZero(_config.stakingRouter);
        treasury = _assertNonZero(_config.treasury);
        validatorExitBus = _assertNonZero(_config.validatorExitBus);
        withdrawalQueue = _assertNonZero(_config.withdrawalQueue);
        withdrawalVault = _assertNonZero(_config.withdrawalVault);
        postTokenRebaseReceiver = _assertNonZero(_config.postTokenRebaseReceiver);
    }

    function coreComponents() external view returns(
        address,
        address,
        address,
        address,
        address,
        address
    ) {
        return (
            elRewardsVault,
            safetyNetsRegistry,
            stakingRouter,
            treasury,
            withdrawalQueue,
            withdrawalVault
        );
    }

    function oracleReportComponentsForLido() external view returns(
        address,
        address,
        address,
        address,
        address,
        address,
        address
    ) {
        return (
            accountingOracle,
            elRewardsVault,
            safetyNetsRegistry,
            selfOwnedStEthBurner,
            withdrawalQueue,
            withdrawalVault,
            postTokenRebaseReceiver
        );
    }

    function _assertNonZero(address _address) internal pure returns (address) {
        if (_address == address(0)) revert ErrorZeroAddress();
        return _address;
    }
}
