// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingRouter} from "../DepositSecurityModule.sol";

contract StakingRouterMockForDepositSecurityModule is IStakingRouter {
    event StakingModuleDeposited(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata);
    event StakingModulePaused(uint24 stakingModuleId);
    event StakingModuleUnpaused(uint24 stakingModuleId);

    bool private isStakingModulePaused;
    uint256 private stakingModuleKeysOpIndex;
    uint256 private stakingModuleLastDepositBlock;

    function getSharesTable()
        external
        returns (
            address[] memory recipients,
            uint256[] memory moduleShares,
            uint256 totalShare
        )
    {}

    function deposit(
        uint256 maxDepositsCount,
        uint24 stakingModuleId,
        bytes calldata depositCalldata
    ) external {
        emit StakingModuleDeposited(maxDepositsCount, stakingModuleId, depositCalldata);
    }

    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external {}

    function pauseStakingModule(uint24 stakingModuleId) external {
        emit StakingModulePaused(stakingModuleId);
    }

    function unpauseStakingModule(uint24 stakingModuleId) external {
        emit StakingModuleUnpaused(stakingModuleId);
    }

    function getWithdrawalCredentials() external view returns (bytes32) {}

    function getStakingModuleIsPaused(uint24) external view returns (bool) {
        return isStakingModulePaused;
    }

    function getStakingModuleKeysOpIndex(uint24) external view returns (uint256) {
        return stakingModuleKeysOpIndex;
    }

    function getStakingModuleLastDepositBlock(uint24) external view returns (uint256) {
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
