// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

interface IStakingRouter {
    function getStakingRewardsDistribution() external returns (address[] memory recipients, uint96[] memory moduleFees, uint96 totalFee);

    function deposit(uint256 maxDepositsCount, uint24 stakingModuleId, bytes depositCalldata) external payable returns (uint256);

    /**
     * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
     * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
     * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
     */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external;

    /**
     * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
     */
    function getWithdrawalCredentials() external view returns (bytes32);

    function getStakingModuleStatus(uint24 _stakingModuleId) external view returns (uint8 status);

    function setStakingModuleStatus(uint24 _stakingModuleId, uint8 _status) external;

    function pauseStakingModule(uint24 _stakingModuleId) external;

    function resumeStakingModule(uint24 _stakingModuleId) external;

    function getStakingModuleIsStopped(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsDepositsPaused(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsActive(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256);

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256);

    function getStakingModuleActiveKeysCount(uint24 _stakingModuleId) external view returns (uint256);

    function estimateStakingModuleMaxDepositableKeys(uint24 _stakingModuleId, uint256 _keysToAllocate) external view returns (uint256);

    function getKeysAllocation(uint256 _keysToAllocate) external view returns (uint256 allocated, uint256[] memory allocations);
}
