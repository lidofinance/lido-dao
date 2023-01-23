// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

interface IStakingRouter {
    function getStakingRewardsDistribution()
        external
        view
        returns (address[] memory recipients, uint96[] memory stakingModuleFees, uint96 totalFeee, uint256 precisionPoints);

    function deposit(uint256 maxDepositsCount, uint256 stakingModuleId, bytes calldata depositCalldata) external payable returns (uint256);

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

    struct StakingModule {
        /// @notice unique id of the staking module
        uint24 id;
        /// @notice address of staking module
        address stakingModuleAddress;
        /// @notice rewarf fee of the staking module
        uint16 stakingModuleFee;
        /// @notice treasury fee
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 targetShare;
        /// @notice staking module status if staking module can not accept the deposits or can participate in further reward distribution
        uint8 status;
        /// @notice name of staking module
        string name;
        /// @notice block.timestamp of the last deposit of the staking module
        uint64 lastDepositAt;
        /// @notice block.number of the last deposit of the staking module
        uint256 lastDepositBlock;
    }

    function getStakingModules() external view returns (StakingModule[] memory res);

    function addStakingModule(
        string memory _name,
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _stakingModuleFee,
        uint16 _treasuryFee
    ) external;

    function updateStakingModule(uint256 _stakingModuleId, uint16 _targetShare, uint16 _stakingModuleFee, uint16 _treasuryFee) external;

    function getStakingModule(uint256 _stakingModuleId) external view returns (StakingModule memory);

    function getStakingModulesCount() external view returns (uint256);

    function getStakingModuleStatus(uint256 _stakingModuleId) external view returns (StakingModuleStatus);

    function setStakingModuleStatus(uint256 _stakingModuleId, StakingModuleStatus _status) external;

    function pauseStakingModule(uint256 _stakingModuleId) external;

    function resumeStakingModule(uint256 _stakingModuleId) external;

    function getStakingModuleIsStopped(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsDepositsPaused(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleIsActive(uint256 _stakingModuleId) external view returns (bool);

    function getStakingModuleKeysOpIndex(uint256 _stakingModuleId) external view returns (uint256);

    function getStakingModuleLastDepositBlock(uint256 _stakingModuleId) external view returns (uint256);

    function getStakingModuleActiveKeysCount(uint256 _stakingModuleId) external view returns (uint256);

    function getKeysAllocation(uint256 _keysToAllocate) external view returns (uint256 allocated, uint256[] memory allocations);

    function getStakingModuleMaxDepositableKeys(uint256 _stakingModuleIndex) external view returns (uint256);
}
