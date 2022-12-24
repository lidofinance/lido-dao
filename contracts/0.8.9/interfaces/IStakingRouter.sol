// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

interface IStakingRouter {
    function getStakingRewardsDistribution() external returns (address[] memory recipients, uint16[] memory moduleFees, uint16 totalFee);

    function deposit(uint256 maxDepositsCount, uint24 stakingModuleId, bytes calldata depositCalldata) external returns (uint256);

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

    enum StakingModuleStatus {
        Active, // deposits and rewards allowed
        DepositsPaused, // deposits NOT allowed, rewards allowed
        Stopped // deposits and rewards NOT allowed
    }

    function getStakingModuleStatus(uint24 _stakingModuleId) external view returns (StakingModuleStatus);

    function setStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) external;

    function pauseStakingModule(uint24 _stakingModuleId) external;

    function unpauseStakingModule(uint24 _stakingModuleId) external;

    function getStakingModuleIsStopped(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsDepositsPaused(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsActive(uint24 _stakingModuleId) external view returns (bool);

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256);

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256);
}
