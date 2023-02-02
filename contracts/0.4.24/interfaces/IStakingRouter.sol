// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

interface IStakingRouter {
    function getStakingRewardsDistribution()
        external
        view
        returns (address[] memory recipients, uint96[] memory moduleFees, uint96 totalFeee, uint256 precisionPoints);

    function deposit(uint256 maxDepositsCount, uint256 stakingModuleId, bytes depositCalldata) external payable returns (uint256);

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

    function getStakingModuleStatus(uint256 _stakingModuleId) external view returns (uint8 status);

    function setStakingModuleStatus(uint256 _stakingModuleId, uint8 _status) external;

    function pauseStakingModule(uint256 _stakingModuleId) external;

    function resumeStakingModule(uint256 _stakingModuleId) external;

    function getStakingModuleIsStopped(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsDepositsPaused(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsActive(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleKeysOpIndex(uint256 _stakingModuleId) external view returns (uint256);

    function getStakingModuleLastDepositBlock(uint256 _stakingModuleId) external view returns (uint256);

    function getStakingModuleActiveKeysCount(uint256 _stakingModuleId) external view returns (uint256);

    function getKeysAllocation(uint256 _keysToAllocate) external view returns (uint256 allocated, uint256[] memory allocations);

    function getStakingModuleMaxDepositableKeys(uint256 _stakingModuleId) external view returns (uint256);
}
