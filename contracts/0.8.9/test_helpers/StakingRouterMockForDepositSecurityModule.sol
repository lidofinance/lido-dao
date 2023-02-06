// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingRouter} from "../DepositSecurityModule.sol";
import {StakingRouter} from "../StakingRouter.sol";


contract StakingRouterMockForDepositSecurityModule is IStakingRouter {
    event StakingModuleDeposited(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata);
    event StakingModuleStatusSet(uint24 indexed stakingModuleId, StakingRouter.StakingModuleStatus status, address setBy);

    StakingRouter.StakingModuleStatus private status;
    uint256 private stakingModuleKeysOpIndex;
    uint256 private stakingModuleLastDepositBlock;

    function deposit(
        uint256 maxDepositsCount,
        uint256 stakingModuleId,
        bytes calldata depositCalldata
    ) external payable returns (uint256 keysCount) {
        emit StakingModuleDeposited(maxDepositsCount, uint24(stakingModuleId), depositCalldata);
        return maxDepositsCount;
    }

    function getStakingModuleStatus(uint256) external view returns (StakingRouter.StakingModuleStatus) {
        return status;
    }

    function setStakingModuleStatus(uint256 _stakingModuleId, StakingRouter.StakingModuleStatus _status) external {
        emit StakingModuleStatusSet(uint24(_stakingModuleId), _status, msg.sender);
        status = _status;
    }

    function pauseStakingModule(uint256 stakingModuleId) external {
        emit StakingModuleStatusSet(uint24(stakingModuleId), StakingRouter.StakingModuleStatus.DepositsPaused, msg.sender);
        status = StakingRouter.StakingModuleStatus.DepositsPaused;
    }

    function resumeStakingModule(uint256 stakingModuleId) external {
        emit StakingModuleStatusSet(uint24(stakingModuleId), StakingRouter.StakingModuleStatus.Active, msg.sender);
        status = StakingRouter.StakingModuleStatus.Active;
    }

    function getStakingModuleIsStopped(uint256) external view returns (bool) {
        return status == StakingRouter.StakingModuleStatus.Stopped;
    }

    function getStakingModuleIsDepositsPaused(uint256) external view returns (bool) {
        return status == StakingRouter.StakingModuleStatus.DepositsPaused;
    }

    function getStakingModuleIsActive(uint256) external view returns (bool) {
        return status == StakingRouter.StakingModuleStatus.Active;
    }

    function getStakingModuleKeysOpIndex(uint256) external view returns (uint256) {
        return stakingModuleKeysOpIndex;
    }

    function getStakingModuleLastDepositBlock(uint256) external view returns (uint256) {
        return stakingModuleLastDepositBlock;
    }

    function setStakingModuleKeysOpIndex(uint256 value) external {
        stakingModuleKeysOpIndex = value;
    }

    function setStakingModuleLastDepositBlock(uint256 value) external {
        stakingModuleLastDepositBlock = value;
    }
}
