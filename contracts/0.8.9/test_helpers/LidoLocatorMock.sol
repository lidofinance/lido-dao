// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

contract LidoLocatorMock {
    address public immutable lido;
    address public immutable dsm;
    address public immutable elRewardsVault;
    address public immutable oracle;
    address public immutable postTokenRebaseReceiver;
    address public immutable safetyNetsRegestry;
    address public immutable selfOwnedStETHBurner;
    address public immutable stakingRouter;
    address public immutable treasury;
    address public immutable withdrawalQueue;
    address public immutable withdrawalVault;

    constructor (
        address _lido,
        address _dsm,
        address _elRewardsVault,
        address _oracle,
        address _postTokenRebaseReceiver,
        address _safetyNetsRegestry,
        address _selfOwnedStETHBurner,
        address _stakingRouter,
        address _treasury,
        address _withdrawalQueue,
        address _withdrawalVault
    ) {
        lido = _lido;
        dsm = _dsm;
        elRewardsVault = _elRewardsVault;
        oracle = _oracle;
        postTokenRebaseReceiver = _postTokenRebaseReceiver;
        safetyNetsRegestry = _safetyNetsRegestry;
        selfOwnedStETHBurner = _selfOwnedStETHBurner;
        stakingRouter = _stakingRouter;
        treasury = _treasury;
        withdrawalQueue = _withdrawalQueue;
        withdrawalVault = _withdrawalVault;
    }

    function getLido() external view returns (address){
        return lido;
    }
    function getDepositSecurityModule() external view returns (address){
        return dsm;
    }

    function getELRewardsVault() external view returns (address){
        return elRewardsVault;
    }

    function getOracle() external view returns (address){
        return oracle;
    }

    function getPostTokenRebaseReceiver() external view returns (address){
        return postTokenRebaseReceiver;
    }

    function getSafetyNetsRegistry() external view returns (address){
        return safetyNetsRegestry;
    }

    function getSelfOwnedStETHBurner() external view returns (address){
        return selfOwnedStETHBurner;
    }

    function getStakingRouter() external view returns (address){
        return stakingRouter;
    }

    function getTreasury() external view returns (address){
        return treasury;
    }

    function getWithdrawalQueue() external view returns (address){
        return withdrawalQueue;
    }

    function getWithdrawalVault() external view returns (address){
        return withdrawalVault;
    }
}