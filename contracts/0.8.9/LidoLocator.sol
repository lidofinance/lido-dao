// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {ILidoLocator} from "../common/interfaces/ILidoLocator.sol";

/**
 * @title LidoLocator
 * @author mymphe
 * @notice Service Locator of Lido
 */
contract LidoLocator is ILidoLocator {
    error ErrorIncorrectLength();
    error ErrorZeroAddress();

    address internal immutable lido;
    address internal immutable depositSecurityModule;
    address internal immutable elRewardsVault;
    address internal immutable oracle;
    address internal immutable compositePostRebaseBeaconReceiver;
    address internal immutable safetyNetsRegistry;
    address internal immutable selfOwnedStETHBurner;
    address internal immutable stakingRouter;
    address internal immutable treasury;
    address internal immutable withdrawalQueue;
    address internal immutable withdrawalVault;

    /**
     * @notice declare service locations
     * @dev accepts an array to avoid the "stack-too-deep" error
     * @param _addresses array of addresses
     * Order follows the logic: Lido and the rest are in the alphabetical order:
     * [0] Lido
     * [1] CompositePostRebaseBeaconReceiver;
     * [2] DepositSecurityModule
     * [3] ELRewardsVault
     * [4] Oracle;
     * [5] SafetyNetsRegistry;
     * [6] SelfOwnedStETHBurner;
     * [7] StakingRouter;
     * [8] Treasury;
     * [9] WithdrawalQueue;
     * [10] WithdrawalVault;
     */
    constructor(address[] memory _addresses) {
        if (_addresses.length != 11) revert ErrorIncorrectLength();

        if (_addresses[0] == address(0)) revert ErrorZeroAddress();
        lido = _addresses[0];

        if (_addresses[1] == address(0)) revert ErrorZeroAddress();
        compositePostRebaseBeaconReceiver = _addresses[1];

        if (_addresses[2] == address(0)) revert ErrorZeroAddress();
        depositSecurityModule = _addresses[2];

        if (_addresses[3] == address(0)) revert ErrorZeroAddress();
        elRewardsVault = _addresses[3];

        if (_addresses[4] == address(0)) revert ErrorZeroAddress();
        oracle = _addresses[4];

        if (_addresses[5] == address(0)) revert ErrorZeroAddress();
        safetyNetsRegistry = _addresses[5];

        if (_addresses[6] == address(0)) revert ErrorZeroAddress();
        selfOwnedStETHBurner = _addresses[6];

        if (_addresses[7] == address(0)) revert ErrorZeroAddress();
        stakingRouter = _addresses[7];

        if (_addresses[8] == address(0)) revert ErrorZeroAddress();
        treasury = _addresses[8];

        if (_addresses[9] == address(0)) revert ErrorZeroAddress();
        withdrawalQueue = _addresses[9];

        if (_addresses[10] == address(0)) revert ErrorZeroAddress();
        withdrawalVault = _addresses[10];

    }

    /**
     * @notice get the address of the Lido contract
     * @return address of the Lido contract
     */
    function getLido() external view returns (address) {
        return lido;
    }

    /**
     * @notice get the address of the CompositePostRebaseBeaconReceiver contract
     * @return address of the CompositePostRebaseBeaconReceiver contract
     */
    function getCompositePostRebaseBeaconReceiver() external view returns (address) {
        return compositePostRebaseBeaconReceiver;
    }

    /**
     * @notice get the address of the DepositSecurityModule contract
     * @return address of the DepositSecurityModule contract
     */
    function getDepositSecurityModule() external view returns (address) {
        return depositSecurityModule;
    }

    /**
     * @notice get the address of the ELRewardsVault contract
     * @return address of the ELRewardsVault contract
     */
    function getELRewardsVault() external view returns (address) {
        return elRewardsVault;
    }

    /**
     * @notice get the address of the Oracle contract
     * @return address of the Oracle contract
     */
    function getOracle() external view returns (address) {
        return oracle;
    }

    /**
     * @notice get the address of the SafetyNetsRegistry contract
     * @return address of the SafetyNetsRegistry contract
     */
    function getSafetyNetsRegistry() external view returns (address) {
        return safetyNetsRegistry;
    }

    /**
     * @notice get the address of the SelfOwnedStETHBurner contract
     * @return address of the SelfOwnedStETHBurner contract
     */
    function getSelfOwnedStETHBurner() external view returns (address) {
        return selfOwnedStETHBurner;
    }

    /**
     * @notice get the address of the StakingRouter contract
     * @return address of the StakingRouter contract
     */
    function getStakingRouter() external view returns (address) {
        return stakingRouter;
    }

    /**
     * @notice get the address of the Treasury contract
     * @return address of the Treasury contract
     */
    function getTreasury() external view returns (address) {
        return treasury;
    }

    /**
     * @notice get the address of the tWithdrawalQueue contract
     * @return address of the WithdrawalQueue contract
     */
    function getWithdrawalQueue() external view returns (address) {
        return withdrawalQueue;
    }

    /**
     * @notice get the address of the WithdrawalVault contract
     * @return address of the WithdrawalVault contract
     */
    function getWithdrawalVault() external view returns (address) {
        return withdrawalVault;
    }
}
