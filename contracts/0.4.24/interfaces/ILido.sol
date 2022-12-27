// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "./IStakingRouter.sol";

/**
 * @title Liquid staking pool
 *
 * For the high-level description of the pool operation please refer to the paper.
 * Pool manages withdrawal keys and fees. It receives ether submitted by users on the ETH 1 side
 * and stakes it via the deposit_contract.sol contract. It doesn't hold ether on it's balance,
 * only a small portion (buffer) of it.
 * It also mints new tokens for rewards generated at the ETH 2.0 side.
 *
 * At the moment withdrawals are not possible in the beacon chain and there's no workaround.
 * Pool will be upgraded to an actual implementation when withdrawals are enabled
 * (Phase 1.5 or 2 of Eth2 launch, likely late 2022 or 2023).
 */
interface ILido {
    function totalSupply() external view returns (uint256);

    function getTotalShares() external view returns (uint256);

    /**
     * @notice Stop pool routine operations
     */
    function stop() external;

    /**
     * @notice Resume pool routine operations
     */
    function resume() external;

    /**
     * @notice Stops accepting new Ether to the protocol
     *
     * @dev While accepting new Ether is stopped, calls to the `submit` function,
     * as well as to the default payable function, will revert.
     *
     * Emits `StakingPaused` event.
     */
    function pauseStaking() external;

    /**
     * @notice Resumes accepting new Ether to the protocol (if `pauseStaking` was called previously)
     * NB: Staking could be rate-limited by imposing a limit on the stake amount
     * at each moment in time, see `setStakingLimit()` and `removeStakingLimit()`
     *
     * @dev Preserves staking limit if it was set previously
     *
     * Emits `StakingResumed` event
     */
    function resumeStaking() external;

    /**
     * @notice Sets the staking rate limit
     *
     * @dev Reverts if:
     * - `_maxStakeLimit` == 0
     * - `_maxStakeLimit` >= 2^96
     * - `_maxStakeLimit` < `_stakeLimitIncreasePerBlock`
     * - `_maxStakeLimit` / `_stakeLimitIncreasePerBlock` >= 2^32 (only if `_stakeLimitIncreasePerBlock` != 0)
     *
     * Emits `StakingLimitSet` event
     *
     * @param _maxStakeLimit max stake limit value
     * @param _stakeLimitIncreasePerBlock stake limit increase per single block
     */
    function setStakingLimit(uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock) external;

    /**
     * @notice Removes the staking rate limit
     *
     * Emits `StakingLimitRemoved` event
     */
    function removeStakingLimit() external;

    /**
     * @notice Check staking state: whether it's paused or not
     */
    function isStakingPaused() external view returns (bool);

    /**
     * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
     */
    function getWithdrawalCredentials() external view returns (bytes32);

    /**
     * @notice Returns how much Ether can be staked in the current block
     * @dev Special return values:
     * - 2^256 - 1 if staking is unlimited;
     * - 0 if staking is paused or if limit is exhausted.
     */
    function getCurrentStakeLimit() external view returns (uint256);

    /**
     * @notice Returns full info about current stake limit params and state
     * @dev Might be used for the advanced integration requests.
     * @return isStakingPaused staking pause state (equivalent to return of isStakingPaused())
     * @return isStakingLimitSet whether the stake limit is set
     * @return currentStakeLimit current stake limit (equivalent to return of getCurrentStakeLimit())
     * @return maxStakeLimit max stake limit
     * @return maxStakeLimitGrowthBlocks blocks needed to restore max stake limit from the fully exhausted state
     * @return prevStakeLimit previously reached stake limit
     * @return prevStakeBlockNumber previously seen block number
     */
    function getStakeLimitFullInfo()
        external
        view
        returns (
            bool isStakingPaused,
            bool isStakingLimitSet,
            uint256 currentStakeLimit,
            uint256 maxStakeLimit,
            uint256 maxStakeLimitGrowthBlocks,
            uint256 prevStakeLimit,
            uint256 prevStakeBlockNumber
        );

    event Stopped();
    event Resumed();

    event StakingPaused();
    event StakingResumed();
    event StakingLimitSet(uint256 maxStakeLimit, uint256 stakeLimitIncreasePerBlock);
    event StakingLimitRemoved();

    /**
     * @notice Set Lido protocol contracts (oracle, treasury).
     * @param _oracle oracle contract
     * @param _treasury treasury contract
     */
    function setProtocolContracts(address _oracle, address _treasury) external;

    event ProtocolContactsSet(address oracle, address treasury, address insuranceFund);

    /**
     * @notice Returns current staking rewards  fee rate
     */
    function getFee() external view returns (uint16 feeBasisPoints);

    /**
     * @notice Returns current fee distribution proportion
     */
    function getFeeDistribution() external view returns (uint16 modulesFeeBasisPoints, uint16 treasuryFeeBasisPoints);

    /**
     * @notice A payable function supposed to be called only by LidoExecutionLayerRewardsVault contract
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveELRewards() external payable;

    // The amount of ETH withdrawn from LidoExecutionLayerRewardsVault contract to Lido contract
    event ELRewardsReceived(uint256 amount);

    /**
     * @dev Sets limit on amount of ETH to withdraw from execution layer rewards vault per LidoOracle report
     * @param _limitPoints limit in basis points to amount of ETH to withdraw per LidoOracle report
     */
    function setELRewardsWithdrawalLimit(uint16 _limitPoints) external;

    // Percent in basis points of total pooled ether allowed to withdraw from LidoExecutionLayerRewardsVault per LidoOracle report
    event ELRewardsWithdrawalLimitSet(uint256 limitPoints);

    /**
     * @dev Sets the address of LidoExecutionLayerRewardsVault contract
     * @param _executionLayerRewardsVault Execution layer rewards vault contract address
     */
    function setELRewardsVault(address _executionLayerRewardsVault) external;

    // The `executionLayerRewardsVault` was set as the execution layer rewards vault for Lido
    event ELRewardsVaultSet(address executionLayerRewardsVault);

    /**
     * @notice Ether on the ETH 2.0 side reported by the oracle
     * @param _epoch Epoch id
     * @param _eth2balance Balance in wei on the ETH 2.0 side
     */
    function handleOracleReport(uint256 _epoch, uint256 _eth2balance) external;

    // User functions

    /**
     * @notice Adds eth to the pool
     * @return StETH Amount of StETH generated
     */
    function submit(address _referral) external payable returns (uint256 StETH);

    // Records a deposit made by a user
    event Submitted(address indexed sender, uint256 amount, address referral);

    // The `amount` of ether was sent to the deposit_contract.deposit function
    event Unbuffered(uint256 amount);

    /**
     * @dev Invokes a deposit call to the Staking Router contract and updates buffered counters
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata module calldata
     */
    function deposit(uint256 _maxDepositsCount, uint24 _stakingModuleId, bytes _depositCalldata) external;

    // Info functions

    /**
     * @notice Gets the amount of Ether controlled by the system
     */
    function getTotalPooledEther() external view returns (uint256);

    /**
     * @notice Gets the amount of Ether temporary buffered on this contract balance
     */
    function getBufferedEther() external view returns (uint256);

    /**
     * @dev Gets the amount of Ether temporary buffered on the StakingRouter contract balance
     */
    function getStakingRouterBufferedEther() external view returns (uint256);

    /**
     * @dev Gets the amount of Ether temporary buffered on the Lido and StakingRouter contracts balance
     */
    function getTotalBufferedEther() external view returns (uint256);

    /**
     * @notice Returns the key values related to Beacon-side
     * @return depositedValidators - number of deposited validators
     * @return beaconValidators - number of Lido's validators visible in the Beacon state, reported by oracles
     * @return beaconBalance - total amount of Beacon-side Ether (sum of all the balances of Lido validators)
     */
    function getBeaconStat() external view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance);

    /**
     * @dev Returns StakingRouter contract interface
     */
    function getStakingRouter() public view returns (IStakingRouter);

    /**
     * @dev Sets the address of StakingRouter contract
     * @param stakingRouterAddress StakingRouter contract address
     */
    function setStakingRouter(address stakingRouterAddress) external;

    event StakingRouterSet(address stakingRouterAddress);

    /**
     * @dev Returns Deposit security module contrac address
     */
    function getDepositSecurityModule() external view returns (address);

    /**
     * @dev Sets the address of DepositSecurityModule contract
     * @param dsmAddress DepositSecurityModule contract address
     */
    function setDepositSecurityModule(address dsmAddress) external;

    event DepositSecurityModuleSet(address dsmAddress);

    event ContractVersionSet(uint256 version);

    // The `amount` of ether was sent to the Staking Router
    event TransferredToStakingRouter(uint256 amount);
}
