// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import { IStakingRouter } from "../DepositSecurityModule.sol";


contract StakingRouterMockForDepositSecurityModule is IStakingRouter {
    event StakingModuleDeposited(uint256 maxDepositsCount, address stakingModule, bytes depositCalldata);
    event StakingModulePaused(address stakingModule);
    event StakingModuleUnpaused(address stakingModule);

    bool private isStakingModulePaused;
    uint256 private stakingModuleKeysOpIndex;
    uint256 private stakingModuleLastDepositBlock;

    function deposit(
        uint256 maxDepositsCount,
        address stakingModule,
        bytes calldata depositCalldata
    ) external {
        emit StakingModuleDeposited(maxDepositsCount, stakingModule, depositCalldata);
    }

    function pauseStakingModule(address stakingModule) external {
        emit StakingModulePaused(stakingModule);
    }

    function unpauseStakingModule(address stakingModule) external {
        emit StakingModuleUnpaused(stakingModule);
    }

    function getStakingModuleIsPaused(address) external view returns (bool) {
        return isStakingModulePaused;
    }

    function getStakingModuleKeysOpIndex(address) external view returns (uint256) {
        return stakingModuleKeysOpIndex;
    }

    function getStakingModuleLastDepositBlock(address) external view returns (uint256) {
        return stakingModuleLastDepositBlock;
    }

    function setStakingModuleIsPaused(bool value) external {
        isStakingModulePaused = value;
    }

    function setStakingModuleKeysOpIndex(uint256 value) external {
        stakingModuleKeysOpIndex = value;
    }

    function setStakingModuleLastDepositBlock(uint256 value) external {
        stakingModuleLastDepositBlock = value;
    }
}
