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
    error ErrorZeroAddress(uint256 index);

    address internal immutable LIDO;
    address internal immutable COMPOSITE_POST_REBASE_BEACON_RECEIVER;
    address internal immutable DEPOSIT_SECURITY_MODULE;
    address internal immutable EL_REWARDS_VAULT;
    address internal immutable ACCOUNTING_ORACLE;
    address internal immutable SAFETY_NETS_REGISTRY;
    address internal immutable SELF_OWNED_STETH_BURNER;
    address internal immutable STAKING_ROUTER;
    address internal immutable TREASURY;
    address internal immutable WITHDRAWAL_QUEUE;
    address internal immutable WITHDRAWAL_VAULT;

    /**
     * @notice declare service locations
     * @dev accepts an array to avoid the "stack-too-deep" error
     * @param _addresses array of addresses
     * Order follows the logic: Lido and the rest are in the alphabetical order
     * See actual constructor code for the order.
     */
    constructor(address[] memory _addresses) {
        if (_addresses.length != 11) revert ErrorIncorrectLength();

        for (uint256 i; i < _addresses.length; ++i) {
            if (_addresses[i] == address(0)) revert ErrorZeroAddress(i);
        }

        LIDO = _addresses[0];
        COMPOSITE_POST_REBASE_BEACON_RECEIVER = _addresses[1];
        DEPOSIT_SECURITY_MODULE = _addresses[2];
        EL_REWARDS_VAULT = _addresses[3];
        ACCOUNTING_ORACLE = _addresses[4];
        SAFETY_NETS_REGISTRY = _addresses[5];
        SELF_OWNED_STETH_BURNER = _addresses[6];
        STAKING_ROUTER = _addresses[7];
        TREASURY = _addresses[8];
        WITHDRAWAL_QUEUE = _addresses[9];
        WITHDRAWAL_VAULT = _addresses[10];
    }

    /**
     * @notice get the address of the Lido contract
     * @return address of the Lido contract
     */
    function getLido() external view returns (address) {
        return LIDO;
    }

    /**
     * @notice get the address of the CompositePostRebaseBeaconReceiver contract
     * @return address of the CompositePostRebaseBeaconReceiver contract
     */
    function getCompositePostRebaseBeaconReceiver() external view returns (address) {
        return COMPOSITE_POST_REBASE_BEACON_RECEIVER;
    }

    /**
     * @notice get the address of the DepositSecurityModule contract
     * @return address of the DepositSecurityModule contract
     */
    function getDepositSecurityModule() external view returns (address) {
        return DEPOSIT_SECURITY_MODULE;
    }

    /**
     * @notice get the address of the ELRewardsVault contract
     * @return address of the ELRewardsVault contract
     */
    function getELRewardsVault() external view returns (address) {
        return EL_REWARDS_VAULT;
    }

    /**
     * @notice get the address of the AccountingOracle contract
     * @return address of the AccountingOracle contract
     */
    function getAccountingOracle() external view returns (address) {
        return ACCOUNTING_ORACLE;
    }

    /**
     * @notice get the address of the SafetyNetsRegistry contract
     * @return address of the SafetyNetsRegistry contract
     */
    function getSafetyNetsRegistry() external view returns (address) {
        return SAFETY_NETS_REGISTRY;
    }

    /**
     * @notice get the address of the SelfOwnedStETHBurner contract
     * @return address of the SelfOwnedStETHBurner contract
     */
    function getSelfOwnedStETHBurner() external view returns (address) {
        return SELF_OWNED_STETH_BURNER;
    }

    /**
     * @notice get the address of the StakingRouter contract
     * @return address of the StakingRouter contract
     */
    function getStakingRouter() external view returns (address) {
        return STAKING_ROUTER;
    }

    /**
     * @notice get the address of the Treasury contract
     * @return address of the Treasury contract
     */
    function getTreasury() external view returns (address) {
        return TREASURY;
    }

    /**
     * @notice get the address of the tWithdrawalQueue contract
     * @return address of the WithdrawalQueue contract
     */
    function getWithdrawalQueue() external view returns (address) {
        return WITHDRAWAL_QUEUE;
    }

    /**
     * @notice get the address of the WithdrawalVault contract
     * @return address of the WithdrawalVault contract
     */
    function getWithdrawalVault() external view returns (address) {
        return WITHDRAWAL_VAULT;
    }
}
