// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingRouter} from "../DepositSecurityModule.sol";

contract StakingRouterMockForDepositSecurityModule is IStakingRouter {
    event StakingModuleDeposited(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata);
    event StakingModuleStatusSet(uint24 indexed stakingModuleId, StakingModuleStatus status, address setBy);

    StakingModuleStatus private status;
    uint256 private stakingModuleKeysOpIndex;
    uint256 private stakingModuleLastDepositBlock;

    function getStakingModules() external view returns (StakingModule[] memory res) {}

    function addModule(
        string memory _name,
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external {}

    function updateStakingModule(uint24 _stakingModuleId, uint16 _targetShare, uint16 _moduleFee, uint16 _treasuryFee) external {}

    function getStakingModule(uint24 _stakingModuleId) external view returns (StakingModule memory) {}

    function getStakingModulesCount() public view returns (uint256) {}

    function getStakingRewardsDistribution()
        external
        returns (address[] memory recipients, uint96[] memory moduleFees, uint96 totalFeee, uint256 precisionPoints)
    {}

    function deposit(
        uint256 maxDepositsCount,
        uint24 stakingModuleId,
        bytes calldata depositCalldata
    ) external payable returns (uint256 keysCount) {
        emit StakingModuleDeposited(maxDepositsCount, stakingModuleId, depositCalldata);
        return maxDepositsCount;
    }

    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external {}

    function getStakingModuleStatus(uint24) external view returns (StakingModuleStatus) {
        return status;
    }

    function setStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) external {
        emit StakingModuleStatusSet(_stakingModuleId, _status, msg.sender);
        status = _status;
    }

    function pauseStakingModule(uint24 stakingModuleId) external {
        emit StakingModuleStatusSet(stakingModuleId, StakingModuleStatus.DepositsPaused, msg.sender);
        status = StakingModuleStatus.DepositsPaused;
    }

    function resumeStakingModule(uint24 stakingModuleId) external {
        emit StakingModuleStatusSet(stakingModuleId, StakingModuleStatus.Active, msg.sender);
        status = StakingModuleStatus.Active;
    }

    function getWithdrawalCredentials() external view returns (bytes32) {}

    function getStakingModuleIsStopped(uint24) external view returns (bool) {
        return status == StakingModuleStatus.Stopped;
    }

    function getStakingModuleIsDepositsPaused(uint24) external view returns (bool) {
        return status == StakingModuleStatus.DepositsPaused;
    }

    function getStakingModuleIsActive(uint24) external view returns (bool) {
        return status == StakingModuleStatus.Active;
    }

    function getStakingModuleKeysOpIndex(uint24) external view returns (uint256) {
        return stakingModuleKeysOpIndex;
    }

    function getStakingModuleLastDepositBlock(uint24) external view returns (uint256) {
        return stakingModuleLastDepositBlock;
    }

    function setStakingModuleKeysOpIndex(uint256 value) external {
        stakingModuleKeysOpIndex = value;
    }

    function setStakingModuleLastDepositBlock(uint256 value) external {
        stakingModuleLastDepositBlock = value;
    }

    function getStakingModuleActiveKeysCount(uint24 _stakingModuleId) external view returns (uint256) {}

    function getKeysAllocation(uint256 _keysToAllocate) external view returns (uint256 allocated, uint256[] memory allocations) {}

    function getStakingModuleMaxDepositableKeys(uint24 _stakingModuleId) external view returns (uint256) {}
}
