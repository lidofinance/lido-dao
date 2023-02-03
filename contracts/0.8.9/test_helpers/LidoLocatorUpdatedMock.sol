// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


/**
 * @title LidoLocatorUpdatedMock
 * @notice an updated impl of LidoLocator with a different interface
 */
contract LidoLocatorUpdatedMock {
    error ErrorIncorrectLength();
    error ErrorZeroAddress();

    address internal immutable lido;
    address internal immutable elRewardsVault;
    address internal immutable oracle;
    address internal immutable compositePostRebaseBeaconReceiver;
    address internal immutable safetyNetsRegistries;
    address internal immutable selfOwnedStETHBurner;
    address internal immutable stakingRouter;
    address internal immutable someNewLidoService0;
    address internal immutable someNewLidoService1;
    address internal immutable treasury;
    address internal immutable withdrawalQueue;
    address internal immutable withdrawalVault;

    /**
     * @notice set the roles manager and initialize necessary state variables
     * @dev accepts an array to avoid the "stack-too-deep" error
     * @param _addresses array of addresses
     * Order follows the logic: Lido and the rest are in the alphabetical order:
     * [] lido;
     * [] elRewardsVault;
     * [] oracle;
     * [] compositePostRebaseBeaconReceiver;
     * [] safetyNetsRegistries;
     * [] selfOwnedStETHBurner;
     * [] stakingRouter;
     * [] someNewLidoService0;
     * [] someNewLidoService1;
     * [] treasury;
     * [] withdrawalQueue;
     * [] withdrawalVault;
     */
    constructor(address[] memory _addresses) {
        if (_addresses.length != 12) revert ErrorIncorrectLength();

        if (_addresses[0] == address(0)) revert ErrorZeroAddress();
        lido = _addresses[0];

        if (_addresses[1] == address(0)) revert ErrorZeroAddress();
        elRewardsVault = _addresses[1];

        if (_addresses[2] == address(0)) revert ErrorZeroAddress();
        oracle = _addresses[2];

        if (_addresses[3] == address(0)) revert ErrorZeroAddress();
        compositePostRebaseBeaconReceiver = _addresses[3];

        if (_addresses[4] == address(0)) revert ErrorZeroAddress();
        safetyNetsRegistries = _addresses[4];

        if (_addresses[5] == address(0)) revert ErrorZeroAddress();
        selfOwnedStETHBurner = _addresses[5];

        if (_addresses[6] == address(0)) revert ErrorZeroAddress();
        stakingRouter = _addresses[6];

        if (_addresses[7] == address(0)) revert ErrorZeroAddress();
        someNewLidoService0 = _addresses[7];

        if (_addresses[8] == address(0)) revert ErrorZeroAddress();
        someNewLidoService1 = _addresses[8];

        if (_addresses[9] == address(0)) revert ErrorZeroAddress();
        treasury = _addresses[9];

        if (_addresses[10] == address(0)) revert ErrorZeroAddress();
        withdrawalQueue = _addresses[10];

        if (_addresses[11] == address(0)) revert ErrorZeroAddress();
        withdrawalVault = _addresses[11];
    }


    function getLido() external view returns(address) {
        return lido;
    }

    function getElRewardsVault() external view returns(address) {
        return elRewardsVault;
    }

    function getOracle() external view returns(address) {
        return oracle;
    }

    function getCompositePostRebaseBeaconReceiver() external view returns(address) {
        return compositePostRebaseBeaconReceiver;
    }

    function getSafetyNetsRegistries() external view returns(address) {
        return safetyNetsRegistries;
    }

    function getSelfOwnedStETHBurner() external view returns(address) {
        return selfOwnedStETHBurner;
    }

    function getStakingRouter() external view returns(address) {
        return stakingRouter;
    }

    function getSomeNewLidoService0() external view returns(address) {
        return someNewLidoService0;
    }

    function getSomeNewLidoService1() external view returns(address) {
        return someNewLidoService1;
    }

    function getTreasury() external view returns(address) {
        return treasury;
    }

    function getWithdrawalQueue() external view returns(address) {
        return withdrawalQueue;
    }

    function getWithdrawalVault() external view returns(address) {
        return withdrawalVault;
    }

}
