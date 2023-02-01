// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./interfaces/INodeOperatorsRegistry.sol";
import "./interfaces/ILidoExecutionLayerRewardsVault.sol";
import "./interfaces/IWithdrawalQueue.sol";
import "./interfaces/IWithdrawalVault.sol";
import "./interfaces/IStakingRouter.sol";
import "./interfaces/ISelfOwnedStETHBurner.sol";

import "./lib/StakeLimitUtils.sol";
import "./lib/PositiveTokenRebaseLimiter.sol";

import "./StETHPermit.sol";

interface IPreTokenRebaseReceiver {
    function handlePreTokenRebase(uint256 preTotalShares, uint256 preTotalPooledEther) external;
}

interface IPostTokenRebaseReceiver {
    function handlePostTokenRebase(
        uint256 preTotalShares,
        uint256 preTotalEther,
        uint256 postTotalShares,
        uint256 postTotalEther,
        uint256 sharesMintedAsFees,
        uint256 timeElapsed
    ) external;
}

/**
* @title Liquid staking pool implementation
*
* Lido is an Ethereum liquid staking protocol solving the problem of frozen staked ether on Consensus Layer
* being unavailable for transfers and DeFi on Execution Layer.
*
* Since balances of all token holders change when the amount of total pooled Ether
* changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
* events upon explicit transfer between holders. In contrast, when Lido oracle reports
* rewards, no Transfer events are generated: doing so would require emitting an event
* for each token holder and thus running an unbounded loop.
*/
contract Lido is StETHPermit, AragonApp {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;
    using StakeLimitUnstructuredStorage for bytes32;
    using StakeLimitUtils for StakeLimitState.Data;
    using PositiveTokenRebaseLimiter for LimiterState.Data;

    /// ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant STAKING_PAUSE_ROLE = keccak256("STAKING_PAUSE_ROLE");
    bytes32 public constant STAKING_CONTROL_ROLE = keccak256("STAKING_CONTROL_ROLE");
    bytes32 public constant MANAGE_PROTOCOL_CONTRACTS_ROLE = keccak256("MANAGE_PROTOCOL_CONTRACTS_ROLE");
    bytes32 public constant BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 public constant MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE = keccak256("MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE");

    uint256 private constant DEPOSIT_SIZE = 32 ether;
    uint256 public constant TOTAL_BASIS_POINTS = 10000;
    /// @dev precision base for measuring token rebase in the contract (e.g.: 1e6 - 0.1%; 1e9 - 100%)
    uint256 public constant TOKEN_REBASE_PRECISION_BASE = 1e9;

    bytes32 internal constant ORACLE_POSITION = keccak256("lido.Lido.oracle");
    bytes32 internal constant TREASURY_POSITION = keccak256("lido.Lido.treasury");
    bytes32 internal constant EL_REWARDS_VAULT_POSITION = keccak256("lido.Lido.executionLayerRewardsVault");
    bytes32 internal constant STAKING_ROUTER_POSITION = keccak256("lido.Lido.stakingRouter");
    bytes32 internal constant DEPOSIT_SECURITY_MODULE_POSITION = keccak256("lido.Lido.depositSecurityModule");
    bytes32 internal constant WITHDRAWAL_QUEUE_POSITION = keccak256("lido.Lido.withdrawalQueue");
    bytes32 internal constant SELF_OWNED_STETH_BURNER_POSITION = keccak256("lido.Lido.selfOwnedStETHBurner");
    bytes32 internal constant PRE_TOKEN_REBASE_RECEIVER_POSITION = keccak256("lido.Lido.preTokenRebaseReceiver");
    bytes32 internal constant POST_TOKEN_REBASE_RECEIVER_POSITION = keccak256("lido.Lido.postTokenRebaseReceiver");
    bytes32 internal constant LAST_ORACLE_REPORT_TIMESTAMP_POSITION = keccak256("lido.Lido.lastOracleReportTimestamp");
    bytes32 internal constant BUNKER_MODE_SINCE_TIMESTAMP_POSITION = keccak256("lido.Lido.bunkerModeSinceTimestamp");

    /// @dev storage slot position of the staking rate limit structure
    bytes32 internal constant STAKING_STATE_POSITION = keccak256("lido.Lido.stakeLimit");
    /// @dev amount of Ether (on the current Ethereum side) buffered on this smart contract balance
    bytes32 internal constant BUFFERED_ETHER_POSITION = keccak256("lido.Lido.bufferedEther");
    /// @dev number of deposited validators (incrementing counter of deposit operations).
    bytes32 internal constant DEPOSITED_VALIDATORS_POSITION = keccak256("lido.Lido.depositedValidators");
    /// @dev total amount of ether on Consensus Layer (sum of all the balances of Lido validators)
    // "beacon" in the `keccak256()` parameter is staying here for compatibility reason
    bytes32 internal constant CL_BALANCE_POSITION = keccak256("lido.Lido.beaconBalance");
    /// @dev number of Lido's validators available in the Consensus Layer state
    // "beacon" in the `keccak256()` parameter is staying here for compatibility reason
    bytes32 internal constant CL_VALIDATORS_POSITION = keccak256("lido.Lido.beaconValidators");
    /// @dev positive token rebase allowed per LidoOracle reports with 1e9 precision
    /// e.g.: 1e6 - 0.1%; 1e9 - 100%
    bytes32 internal constant MAX_POSITIVE_TOKEN_REBASE_POSITION = keccak256("lido.Lido.MaxPositiveTokenRebase");
    /// @dev Just a counter of total amount of execution layer rewards received by Lido contract. Not used in the logic.
    bytes32 internal constant TOTAL_EL_REWARDS_COLLECTED_POSITION = keccak256("lido.Lido.totalELRewardsCollected");
    /// @dev version of contract
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.Lido.contractVersion");

    event ContractVersionSet(uint256 version);

    event Stopped();
    event Resumed();

    event StakingPaused();
    event StakingResumed();
    event StakingLimitSet(uint256 maxStakeLimit, uint256 stakeLimitIncreasePerBlock);
    event StakingLimitRemoved();

    event ProtocolContactsSet(
        address oracle,
        address treasury,
        address executionLayerRewardsVault
    );

    event ETHDistributed(
        uint256 indexed reportTimestamp,
        int256 clBalanceDiff,
        uint256 withdrawalsWithdrawn,
        uint256 executionLayerRewardsWithdrawn,
        uint256 preBufferedEther,
        uint256 postBufferredEther
    );

    event TokenRebase(
        uint256 indexed reportTimestamp,
        uint256 preTotalShares,
        uint256 preTotalEther,
        uint256 postTotalShares,
        uint256 postTotalEther,
        uint256 sharesMintedAsFees,
        uint256 timeElapsed
    );

    // The amount of ETH withdrawn from LidoExecutionLayerRewardsVault to Lido
    event ELRewardsReceived(uint256 amount);

    // The amount of ETH withdrawn from WithdrawalVault to Lido
    event WithdrawalsReceived(uint256 amount);

    // Max positive token rebase per single oracle report set
    event MaxPositiveTokenRebaseSet(uint256 maxPositiveTokenRebase);

    // Records a deposit made by a user
    event Submitted(address indexed sender, uint256 amount, address referral);

    // The `amount` of ether was sent to the deposit_contract.deposit function
    event Unbuffered(uint256 amount);

    event DepositSecurityModuleSet(address dsmAddress);

    event StakingRouterSet(address stakingRouterAddress);

    event WithdrawalQueueSet(address withdrawalQueueAddress);

    event SelfOwnedStETHBurnerSet(address selfOwnedStETHBurner);

    // The amount of ETH sended from StakingRouter contract to Lido contract
    event StakingRouterTransferReceived(uint256 amount);

    /**
    * @dev As AragonApp, Lido contract must be initialized with following variables:
    *      NB: by default, staking and the whole Lido pool are in paused state
    * @param _oracle oracle contract
    * @param _treasury treasury contract
    * @param _stakingRouter Staking router contract
    * @param _dsm Deposit security module contract
    * @param _executionLayerRewardsVault execution layer rewards vault contract
    * @param _withdrawalQueue withdrawal queue contract
    * @param _eip712StETH eip712 helper contract for StETH
    * @param _selfOwnedStETHBurner a dedicated contract for enacting stETH burning requests
    */
    function initialize(
        address _oracle,
        address _treasury,
        address _stakingRouter,
        address _dsm,
        address _executionLayerRewardsVault,
        address _withdrawalQueue,
        address _eip712StETH,
        address _selfOwnedStETHBurner
    )
        public onlyInit
    {
        _setProtocolContracts(_oracle, _treasury, _executionLayerRewardsVault);

        _initialize_v2(_stakingRouter, _dsm, _eip712StETH, _withdrawalQueue, _selfOwnedStETHBurner);
        initialized();
    }

    /**
     * @dev If we are deploying the protocol from scratch there are circular dependencies introduced (StakingRouter and DSM),
     *      so on init stage we need to set `_stakingRouter` and `_dsm` as 0x0, and afterwards use setters for set them correctly
     */
    function _initialize_v2(
        address _stakingRouter,
        address _dsm,
        address _eip712StETH,
        address _withdrawalQueue,
        address _selfOwnedStETHBurner
    ) internal {
        STAKING_ROUTER_POSITION.setStorageAddress(_stakingRouter);
        DEPOSIT_SECURITY_MODULE_POSITION.setStorageAddress(_dsm);
        WITHDRAWAL_QUEUE_POSITION.setStorageAddress(_withdrawalQueue);
        SELF_OWNED_STETH_BURNER_POSITION.setStorageAddress(_selfOwnedStETHBurner);

        CONTRACT_VERSION_POSITION.setStorageUint256(2);

        _initializeEIP712StETH(_eip712StETH);

        emit ContractVersionSet(2);
        emit StakingRouterSet(_stakingRouter);
        emit DepositSecurityModuleSet(_dsm);
        emit WithdrawalQueueSet(_withdrawalQueue);
        emit SelfOwnedStETHBurnerSet(_selfOwnedStETHBurner);
    }

    /**
     * @notice A function to finalize upgrade to v2 (from v1). Can be called only once
     * @dev Value 1 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
     * For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     */
    function finalizeUpgrade_v2(
        address _stakingRouter,
        address _dsm,
        address _eip712StETH,
        address _withdrawalQueue,
        address _selfOwnedStETHBurner
    ) external {
        require(!isPetrified(), "PETRIFIED");
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "WRONG_BASE_VERSION");

        require(_stakingRouter != address(0), "STAKING_ROUTER_ZERO_ADDRESS");
        require(_dsm != address(0), "DSM_ZERO_ADDRESS");
        require(_eip712StETH != address(0), "EIP712_STETH_ZERO_ADDRESS");
        require(_withdrawalQueue != address(0), "WITHDRAWAL_QUEUE_ZERO_ADDRESS");
        require(_selfOwnedStETHBurner != address(0), "SELF_OWNED_STETH_BURNER_ZERO_ADDRESS");

        _initialize_v2(_stakingRouter, _dsm, _eip712StETH, _withdrawalQueue, _selfOwnedStETHBurner);
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * @notice Stops accepting new Ether to the protocol
     *
     * @dev While accepting new Ether is stopped, calls to the `submit` function,
     * as well as to the default payable function, will revert.
     *
     * Emits `StakingPaused` event.
     */
    function pauseStaking() external {
        _auth(STAKING_PAUSE_ROLE);

        _pauseStaking();
    }

    /**
     * @notice Resumes accepting new Ether to the protocol (if `pauseStaking` was called previously)
     * NB: Staking could be rate-limited by imposing a limit on the stake amount
     * at each moment in time, see `setStakingLimit()` and `removeStakingLimit()`
     *
     * @dev Preserves staking limit if it was set previously
     *
     * Emits `StakingResumed` event
     */
    function resumeStaking() external {
        _auth(STAKING_CONTROL_ROLE);

        _resumeStaking();
    }

    /**
     * @notice Sets the staking rate limit
     *
     * ▲ Stake limit
     * │.....  .....   ........ ...            ....     ... Stake limit = max
     * │      .       .        .   .   .      .    . . .
     * │     .       .              . .  . . .      . .
     * │            .                .  . . .
     * │──────────────────────────────────────────────────> Time
     * │     ^      ^          ^   ^^^  ^ ^ ^     ^^^ ^     Stake events
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
    function setStakingLimit(uint256 _maxStakeLimit, uint256 _stakeLimitIncreasePerBlock) external {
        _auth(STAKING_CONTROL_ROLE);

        STAKING_STATE_POSITION.setStorageStakeLimitStruct(
            STAKING_STATE_POSITION.getStorageStakeLimitStruct().setStakingLimit(_maxStakeLimit, _stakeLimitIncreasePerBlock)
        );

        emit StakingLimitSet(_maxStakeLimit, _stakeLimitIncreasePerBlock);
    }

    /**
     * @notice Removes the staking rate limit
     *
     * Emits `StakingLimitRemoved` event
     */
    function removeStakingLimit() external {
        _auth(STAKING_CONTROL_ROLE);

        STAKING_STATE_POSITION.setStorageStakeLimitStruct(STAKING_STATE_POSITION.getStorageStakeLimitStruct().removeStakingLimit());

        emit StakingLimitRemoved();
    }

    /**
     * @notice Check staking state: whether it's paused or not
     */
    function isStakingPaused() external view returns (bool) {
        return STAKING_STATE_POSITION.getStorageStakeLimitStruct().isStakingPaused();
    }


    /**
     * @notice Returns how much Ether can be staked in the current block
     * @dev Special return values:
     * - 2^256 - 1 if staking is unlimited;
     * - 0 if staking is paused or if limit is exhausted.
     */
    function getCurrentStakeLimit() external view returns (uint256) {
        return _getCurrentStakeLimit(STAKING_STATE_POSITION.getStorageStakeLimitStruct());
    }

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
        )
    {
        StakeLimitState.Data memory stakeLimitData = STAKING_STATE_POSITION.getStorageStakeLimitStruct();

        isStakingPaused = stakeLimitData.isStakingPaused();
        isStakingLimitSet = stakeLimitData.isStakingLimitSet();

        currentStakeLimit = _getCurrentStakeLimit(stakeLimitData);

        maxStakeLimit = stakeLimitData.maxStakeLimit;
        maxStakeLimitGrowthBlocks = stakeLimitData.maxStakeLimitGrowthBlocks;
        prevStakeLimit = stakeLimitData.prevStakeLimit;
        prevStakeBlockNumber = stakeLimitData.prevStakeBlockNumber;
    }

    /**
    * @notice Send funds to the pool
    * @dev Users are able to submit their funds by transacting to the fallback function.
    * Unlike vanilla Ethereum Deposit contract, accepting only 32-Ether transactions, Lido
    * accepts payments of any size. Submitted Ethers are stored in Buffer until someone calls
    * deposit() and pushes them to the Ethereum Deposit contract.
    */
    // solhint-disable-next-line
    function() external payable {
        // protection against accidental submissions by calling non-existent function
        require(msg.data.length == 0, "NON_EMPTY_DATA");
        _submit(0);
    }

    /**
     * @notice Send funds to the pool with optional _referral parameter
     * @dev This function is alternative way to submit funds. Supports optional referral address.
     * @return Amount of StETH shares generated
     */
    function submit(address _referral) external payable returns (uint256) {
        return _submit(_referral);
    }

    /**
     * @notice A payable function for execution layer rewards. Can be called only by ExecutionLayerRewardsVault contract
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveELRewards() external payable {
        require(msg.sender == EL_REWARDS_VAULT_POSITION.getStorageAddress());

        TOTAL_EL_REWARDS_COLLECTED_POSITION.setStorageUint256(getTotalELRewardsCollected().add(msg.value));

        emit ELRewardsReceived(msg.value);
    }

    /**
    * @notice A payable function for withdrawals acquisition. Can be called only by WithdrawalVault contract
    * @dev We need a dedicated function because funds received by the default payable function
    * are treated as a user deposit
    */
    function receiveWithdrawals() external payable {
        require(msg.sender == _getWithdrawalVault());

        emit WithdrawalsReceived(msg.value);
    }

    /**
     * @notice A payable function for execution layer rewards. Can be called only by ExecutionLayerRewardsVault contract
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveStakingRouter() external payable {
        require(msg.sender == STAKING_ROUTER_POSITION.getStorageAddress());

        emit StakingRouterTransferReceived(msg.value);
    }

    /**
     * @notice Destroys _sharesAmount shares from _account holdings, decreasing the total amount of shares.
     *
     * @param _account Address where shares will be burned
     * @param _sharesAmount Amount of shares to burn
     * @return Amount of new total shares after tokens burning
     */
    function burnShares(address _account, uint256 _sharesAmount)
        external
        authP(BURN_ROLE, arr(_account, _sharesAmount))
        returns (uint256 newTotalShares)
    {
        return _burnShares(_account, _sharesAmount);
    }

    /**
     * @notice Stop pool routine operations
     */
    function stop() external {
        _auth(PAUSE_ROLE);

        _stop();
        _pauseStaking();
    }

    /**
     * @notice Resume pool routine operations
     * @dev Staking should be resumed manually after this call using the desired limits
     */
    function resume() external {
        _auth(RESUME_ROLE);

        _resume();
        _resumeStaking();
    }

    /**
    * @notice Set Lido protocol contracts (oracle, treasury, execution layer rewards vault).
    *
    * @param _oracle oracle contract
    * @param _treasury treasury contract
    * @param _executionLayerRewardsVault execution layer rewards vault contract
    */
    function setProtocolContracts(
        address _oracle,
        address _treasury,
        address _executionLayerRewardsVault
    ) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);

        _setProtocolContracts(_oracle, _treasury, _executionLayerRewardsVault);
    }

    /**
     * @dev Set max positive rebase allowed per single oracle report
     * token rebase happens on total supply adjustment,
     * huge positive rebase can incur oracle report sandwitching.
     *
     * Default value is not set (explicit initialization required).
     *
     * @param _maxTokenPositiveRebase max positive token rebase value with 1e9 precision:
     *   e.g.: 1e6 - 0.1%; 1e9 - 100%
     * - passing zero value is prohibited
     * - to allow unlimited rebases, pass 100% (1e9)
     *
     * NB: the recommended sane values are from 5e5 (0.05%) to 1e6 (0.1%)
     */
    function setMaxPositiveTokenRebase(uint256 _maxTokenPositiveRebase) external {
        _auth(MANAGE_MAX_POSITIVE_TOKEN_REBASE_ROLE);
        _setMaxPositiveTokenRebase(_maxTokenPositiveRebase);
    }

    struct OracleReportInputData {
        // Oracle report timing
        uint256 reportTimestamp;
        // CL values
        uint256 clValidators;
        uint256 clBalance;
        // EL values
        uint256 withdrawalVaultBalance;
        uint256 elRewardsVaultBalance;
        // Decision about withdrawals processing
        uint256 requestIdToFinalizeUpTo;
        uint256 finalizationShareRate;
        bool isBunkerMode;
    }

    /**
    * @notice Updates accounting stats, collects EL rewards and distributes collected rewards if beacon balance increased
    * @dev periodically called by the Oracle contract
    * @param _reportTimestamp when the report was calculated
    * @param _clValidators number of Lido validators on Consensus Layer
    * @param _clBalance sum of all Lido validators' balances on Consensus Layer
    * @param _withdrawalVaultBalance withdrawal vault balance on Execution Layer for report block
    * @param _elRewardsVaultBalance elRewards vault balance on Execution Layer for report block
    * @param _requestIdToFinalizeUpTo rigth boundary of requestId range if equals 0, no requests should be finalized
    * @param _finalizationShareRate share rate that should be used for finalization
    * @param _isBunkerMode bunker protocol mode state flag
    *
    * @return totalPooledEther amount of ether in the protocol after report
    * @return totalShares amount of shares in the protocol after report
    * @return withdrawals withdrawn from the withdrawals vault
    * @return elRewards withdrawn from the execution layer rewards vault
    */
    function handleOracleReport(
        // Oracle report timing
        uint256 _reportTimestamp,
        // CL values
        uint256 _clValidators,
        uint256 _clBalance,
        // EL values
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        // Decision about withdrawals processing
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate,
        bool _isBunkerMode
    ) external returns (
        uint256 totalPooledEther,
        uint256 totalShares,
        uint256 withdrawals,
        uint256 elRewards
    ) {
        // TODO: safety checks

        require(msg.sender == getOracle(), "APP_AUTH_FAILED");
        _whenNotStopped();

        return _handleOracleReport(
            OracleReportInputData(
                _reportTimestamp,
                _clValidators,
                _clBalance,
                _withdrawalVaultBalance,
                _elRewardsVaultBalance,
                _requestIdToFinalizeUpTo,
                _finalizationShareRate,
                _isBunkerMode
            )
        );
    }

    /**
     * @notice Overrides default AragonApp behaviour to disallow recovery.
     */
    function transferToVault(address /* _token */) external {
        revert("NOT_SUPPORTED");
    }

    /**
    * @notice Returns the address of the vault where withdrawals arrive
    * @dev withdrawal vault address is encoded as a last 160 bits of withdrawal credentials type 0x01
    * @return address of the vault or address(0) if the vault is not set
    */
    function getWithdrawalVault() external view returns (address) {
        return _getWithdrawalVault();
    }

    /**
     * @notice Returns WithdrawalQueue contract.
     */
    function getWithdrawalQueue() public view returns (address) {
        return WITHDRAWAL_QUEUE_POSITION.getStorageAddress();
    }

    function setWithdrawalQueue(address _withdrawalQueue) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_withdrawalQueue != address(0), "WITHDRAWAL_QUEUE_ADDRESS_ZERO");

        WITHDRAWAL_QUEUE_POSITION.setStorageAddress(_withdrawalQueue);

        emit WithdrawalQueueSet(_withdrawalQueue);
    }

    /**
    * @notice Get the amount of Ether temporary buffered on this contract balance
    * @dev Buffered balance is kept on the contract from the moment the funds are received from user
    * until the moment they are actually sent to the official Deposit contract.
    * @return amount of buffered funds in wei
    */
    function getBufferedEther() external view returns (uint256) {
        return _getBufferedEther();
    }

    /**
     * @notice Get total amount of execution layer rewards collected to Lido contract
     * @dev Ether got through LidoExecutionLayerRewardsVault is kept on this contract's balance the same way
     * as other buffered Ether is kept (until it gets deposited)
     * @return amount of funds received as execution layer rewards (in wei)
     */
    function getTotalELRewardsCollected() public view returns (uint256) {
        return TOTAL_EL_REWARDS_COLLECTED_POSITION.getStorageUint256();
    }

    /**
     * @notice Get max positive token rebase value
     * @return max positive token rebase value, nominated id MAX_POSITIVE_REBASE_PRECISION_POINTS (10**9 == 100% = 10000 BP)
     */
    function getMaxPositiveTokenRebase() public view returns (uint256) {
        return MAX_POSITIVE_TOKEN_REBASE_POSITION.getStorageUint256();
    }

    /**
     * @notice Gets authorized oracle address
     * @return address of oracle contract
     */
    function getOracle() public view returns (address) {
        return ORACLE_POSITION.getStorageAddress();
    }

    /**
     * @notice Returns the treasury address
     */
    function getTreasury() public view returns (address) {
        return TREASURY_POSITION.getStorageAddress();
    }

    function getPreTokenRebaseReceiver() public view returns (address) {
        return PRE_TOKEN_REBASE_RECEIVER_POSITION.getStorageAddress();
    }

    function getPostTokenRebaseReceiver() public view returns (address) {
        return POST_TOKEN_REBASE_RECEIVER_POSITION.getStorageAddress();
    }

    /**
    * @notice Returns the key values related to Consensus Layer side of the contract. It historically contains beacon
    * @return depositedValidators - number of deposited validators from Lido contract side
    * @return beaconValidators - number of Lido validators visible on Consensus Layer, reported by oracle
    * @return beaconBalance - total amount of ether on the Consensus Layer side (sum of all the balances of Lido validators)
    *
    * @dev `beacon` in naming still here for historical reasons
    */
    function getBeaconStat() external view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance) {
        depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        beaconValidators = CL_VALIDATORS_POSITION.getStorageUint256();
        beaconBalance = CL_BALANCE_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns current withdrawal credentials of deposited validators
     * @dev DEPRECATED: use StakingRouter.getWithdrawalCredentials() instead
     */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return getStakingRouter().getWithdrawalCredentials();
    }

    /**
     * @notice Returns address of the contract set as LidoExecutionLayerRewardsVault
     */
    function getELRewardsVault() public view returns (address) {
        return EL_REWARDS_VAULT_POSITION.getStorageAddress();
    }

    /// @dev updates Consensus Layer state according to the current report
    function _processClStateUpdate(
        uint256 _postClValidators,
        uint256 _postClBalance
    ) internal returns (int256 clBalanceDiff) {
        uint256 depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        require(_postClValidators <= depositedValidators, "REPORTED_MORE_DEPOSITED");

        uint256 preClValidators = CL_VALIDATORS_POSITION.getStorageUint256();
        require(_postClValidators >= preClValidators, "REPORTED_LESS_VALIDATORS");

        // Save the current CL balance and validators to
        // calculate rewards on the next push
        CL_BALANCE_POSITION.setStorageUint256(_postClBalance);

        if (_postClValidators > preClValidators) {
            CL_VALIDATORS_POSITION.setStorageUint256(_postClValidators);
        }

        uint256 appearedValidators = _postClValidators.sub(preClValidators);
        uint256 preCLBalance = CL_BALANCE_POSITION.getStorageUint256();
        uint256 rewardsBase = appearedValidators.mul(DEPOSIT_SIZE).add(preCLBalance);

        return _signedSub(int256(_postClBalance), int256(rewardsBase));
    }

    /// @dev collect ETH from ELRewardsVault and WithdrawalVault and send to WithdrawalQueue
    function _processETHDistribution(
        uint256 _withdrawalsToWithdraw,
        uint256 _elRewardsToWithdraw,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) internal {
        // withdraw execution layer rewards and put them to the buffer
        if (_elRewardsToWithdraw > 0) {
            ILidoExecutionLayerRewardsVault(getELRewardsVault()).withdrawRewards(_elRewardsToWithdraw);
        }

        // withdraw withdrawals and put them to the buffer
        if (_withdrawalsToWithdraw > 0) {
            IWithdrawalVault(_getWithdrawalVault()).withdrawWithdrawals(_withdrawalsToWithdraw);
        }

        uint256 lockedToWithdrawalQueue = 0;
        if (_requestIdToFinalizeUpTo > 0) {
            lockedToWithdrawalQueue = _processWithdrawalQueue(
                _requestIdToFinalizeUpTo,
                _finalizationShareRate
            );
        }

        uint256 preBufferedEther = _getBufferedEther();
        uint256 postBufferedEther = _getBufferedEther()
            .add(_elRewardsToWithdraw) // Collected from ELVault
            .add(_withdrawalsToWithdraw) // Collected from WithdrawalVault
            .sub(lockedToWithdrawalQueue); // Sent to WithdrawalQueue

        // Storing even the same value costs gas, so just avoid it
        if (preBufferedEther != postBufferedEther) {
            BUFFERED_ETHER_POSITION.setStorageUint256(postBufferedEther);
        }
    }

    ///@dev finalize withdrawal requests in the queue, burn their shares and return the amount of ether locked for claiming
    function _processWithdrawalQueue(
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) internal returns (uint256 lockedToWithdrawalQueue) {
        IWithdrawalQueue withdrawalQueue = IWithdrawalQueue(getWithdrawalQueue());

        if (withdrawalQueue.isPaused()) return 0;

        (uint256 etherToLock, uint256 sharesToBurn) = withdrawalQueue.finalizationBatch(
            _requestIdToFinalizeUpTo,
            _finalizationShareRate
        );

        _burnShares(address(withdrawalQueue), sharesToBurn);
        withdrawalQueue.finalize.value(etherToLock)(_requestIdToFinalizeUpTo);

        return etherToLock;
    }

    /// @dev calculate the amount of rewards and distribute it
    function _processRewards(
        int256 _clBalanceDiff,
        uint256 _withdrawnWithdrawals,
        uint256 _withdrawnElRewards
    ) internal returns (uint256 sharesMintedAsFees) {
        int256 consensusLayerRewards = _signedAdd(_clBalanceDiff, int256(_withdrawnWithdrawals));
        // Don’t mint/distribute any protocol fee on the non-profitable Lido oracle report
        // (when consensus layer balance delta is zero or negative).
        // See ADR #3 for details:
        // https://research.lido.fi/t/rewards-distribution-after-the-merge-architecture-decision-record/1535
        if (consensusLayerRewards > 0) {
            sharesMintedAsFees = _distributeFee(uint256(consensusLayerRewards).add(_withdrawnElRewards));
        }
    }

    /**
    * @dev Internal function to set authorized oracle address
    * @param _oracle oracle contract
    * @param _treasury treasury contract
    * @param _executionLayerRewardsVault execution layer rewards vault contract
    */
    function _setProtocolContracts(
        address _oracle, address _treasury, address _executionLayerRewardsVault
    ) internal {
        require(_oracle != address(0), "ORACLE_ZERO_ADDRESS");
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");
        //NB: _executionLayerRewardsVault can be zero

        ORACLE_POSITION.setStorageAddress(_oracle);
        TREASURY_POSITION.setStorageAddress(_treasury);
        EL_REWARDS_VAULT_POSITION.setStorageAddress(_executionLayerRewardsVault);

        emit ProtocolContactsSet(_oracle, _treasury, _executionLayerRewardsVault);
    }

    /**
     * @dev Process user deposit, mints liquid tokens and increase the pool buffer
     * @param _referral address of referral.
     * @return amount of StETH shares generated
     */
    function _submit(address _referral) internal returns (uint256) {
        require(msg.value != 0, "ZERO_DEPOSIT");

        StakeLimitState.Data memory stakeLimitData = STAKING_STATE_POSITION.getStorageStakeLimitStruct();
        require(!stakeLimitData.isStakingPaused(), "STAKING_PAUSED");

        if (stakeLimitData.isStakingLimitSet()) {
            uint256 currentStakeLimit = stakeLimitData.calculateCurrentStakeLimit();

            require(msg.value <= currentStakeLimit, "STAKE_LIMIT");

            STAKING_STATE_POSITION.setStorageStakeLimitStruct(stakeLimitData.updatePrevStakeLimit(currentStakeLimit - msg.value));
        }

        uint256 sharesAmount;
        if (_getTotalPooledEther() != 0) {
            sharesAmount = getSharesByPooledEth(msg.value);
        } else {
            // totalPooledEther is 0: for first-ever deposit
            // assume that shares correspond to Ether 1-to-1
            sharesAmount = msg.value;
        }

        _mintShares(msg.sender, sharesAmount);

        BUFFERED_ETHER_POSITION.setStorageUint256(_getBufferedEther().add(msg.value));
        emit Submitted(msg.sender, msg.value, _referral);

        _emitTransferAfterMintingShares(msg.sender, sharesAmount);
        return sharesAmount;
    }

    /**
     * @dev Emits {Transfer} and {TransferShares} events where `from` is 0 address. Indicates mint events.
     */
    function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount) internal {
        emit Transfer(address(0), _to, getPooledEthByShares(_sharesAmount));
        emit TransferShares(address(0), _to, _sharesAmount);
    }

    function getStakingRouter() public view returns (IStakingRouter) {
        return IStakingRouter(STAKING_ROUTER_POSITION.getStorageAddress());
    }

    function setStakingRouter(address _stakingRouter) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_stakingRouter != address(0), "STAKING_ROUTER_ADDRESS_ZERO");
        STAKING_ROUTER_POSITION.setStorageAddress(_stakingRouter);

        emit StakingRouterSet(_stakingRouter);
    }

    function getDepositSecurityModule() public view returns (address) {
        return DEPOSIT_SECURITY_MODULE_POSITION.getStorageAddress();
    }

    function setDepositSecurityModule(address _dsm) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_dsm != address(0), "DSM_ADDRESS_ZERO");
        DEPOSIT_SECURITY_MODULE_POSITION.setStorageAddress(_dsm);

        emit DepositSecurityModuleSet(_dsm);
    }

    /**
     * @dev Distributes fee portion of the rewards by minting and distributing corresponding amount of liquid tokens.
     * @param _totalRewards Total rewards accrued both on the Execution Layer and the Consensus Layer sides in wei.
     */
    function _distributeFee(uint256 _totalRewards) internal returns (uint256 sharesMintedAsFees) {
        // We need to take a defined percentage of the reported reward as a fee, and we do
        // this by minting new token shares and assigning them to the fee recipients (see
        // StETH docs for the explanation of the shares mechanics). The staking rewards fee
        // is defined in basis points (1 basis point is equal to 0.01%, 10000 (TOTAL_BASIS_POINTS) is 100%).
        //
        // Since we've increased totalPooledEther by _totalRewards (which is already
        // performed by the time this function is called), the combined cost of all holders'
        // shares has became _totalRewards StETH tokens more, effectively splitting the reward
        // between each token holder proportionally to their token share.
        //
        // Now we want to mint new shares to the fee recipient, so that the total cost of the
        // newly-minted shares exactly corresponds to the fee taken:
        //
        // shares2mint * newShareCost = (_totalRewards * totalFee) / PRECISION_POINTS
        // newShareCost = newTotalPooledEther / (prevTotalShares + shares2mint)
        //
        // which follows to:
        //
        //                        _totalRewards * totalFee * prevTotalShares
        // shares2mint = --------------------------------------------------------------
        //                 (newTotalPooledEther * PRECISION_POINTS) - (_totalRewards * totalFee)
        //
        // The effect is that the given percentage of the reward goes to the fee recipient, and
        // the rest of the reward is distributed between token holders proportionally to their
        // token shares.
        IStakingRouter router = getStakingRouter();

        (address[] memory recipients,
            uint256[] memory moduleIds,
            uint96[] memory modulesFees,
            uint96 totalFee,
            uint256 precisionPoints) = router.getStakingRewardsDistribution();

        require(recipients.length == modulesFees.length, "WRONG_RECIPIENTS_INPUT");
        require(moduleIds.length == modulesFees.length, "WRONG_MODULE_IDS_INPUT");

        if (totalFee > 0) {
            sharesMintedAsFees =
                _totalRewards.mul(totalFee).mul(_getTotalShares()).div(
                    _getTotalPooledEther().mul(precisionPoints).sub(_totalRewards.mul(totalFee))
                );

            _mintShares(address(this), sharesMintedAsFees);

            (uint256[] memory moduleRewards, uint256 totalModuleRewards) =
                _transferModuleRewards(recipients, modulesFees, totalFee, sharesMintedAsFees);

            _transferTreasuryRewards(sharesMintedAsFees.sub(totalModuleRewards));

            router.reportRewardsMinted(moduleIds, moduleRewards);
        }
    }

    function _transferModuleRewards(
        address[] memory recipients,
        uint96[] memory modulesFees,
        uint256 totalFee,
        uint256 totalRewards
    ) internal returns (uint256[] memory moduleRewards, uint256 totalModuleRewards) {
        totalModuleRewards = 0;
        moduleRewards = new uint256[](recipients.length);

        for (uint256 i = 0; i < recipients.length; i++) {
            if (modulesFees[i] > 0) {
                uint256 iModuleRewards = totalRewards.mul(modulesFees[i]).div(totalFee);
                moduleRewards[i] = iModuleRewards;
                _transferShares(address(this), recipients[i], iModuleRewards);
                _emitTransferAfterMintingShares(recipients[i], iModuleRewards);
                totalModuleRewards = totalModuleRewards.add(iModuleRewards);
            }
        }
    }

    function _transferTreasuryRewards(uint256 treasuryReward) internal {
        address treasury = getTreasury();
        _transferShares(address(this), treasury, treasuryReward);
        _emitTransferAfterMintingShares(treasury, treasuryReward);
    }

    /**
    * @dev Records a deposit to the deposit_contract.deposit function
    * @param _amount Total amount deposited to the Consensus Layer side
    */
    function _markAsUnbuffered(uint256 _amount) internal {
        BUFFERED_ETHER_POSITION.setStorageUint256(_getBufferedEther().sub(_amount));

        emit Unbuffered(_amount);
    }

    /**
    * @dev Write a value nominated in basis points
    */
    function _setBPValue(bytes32 _slot, uint16 _value) internal {
        require(_value <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");
        _slot.setStorageUint256(uint256(_value));
    }

    /**
     * @dev Gets the amount of Ether temporary buffered on this contract balance
     */
    function _getBufferedEther() internal view returns (uint256) {
        return BUFFERED_ETHER_POSITION.getStorageUint256();
    }

    /**
     * @dev Gets unaccounted (excess) Ether on this contract balance
     */
    function _getUnaccountedEther() internal view returns (uint256) {
        return address(this).balance.sub(_getBufferedEther());
    }

    function _getWithdrawalVault() internal view returns (address) {
        uint8 credentialsType = uint8(uint256(getWithdrawalCredentials()) >> 248);
        if (credentialsType == 0x01) {
            return address(uint160(getWithdrawalCredentials()));
        }
        return address(0);
    }

    /// @dev Calculates and returns the total base balance (multiple of 32) of validators in transient state,
    ///     i.e. submitted to the official Deposit contract but not yet visible in the CL state.
    /// @return transient balance in wei (1e-18 Ether)
    function _getTransientBalance() internal view returns (uint256) {
        uint256 depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        uint256 clValidators = CL_VALIDATORS_POSITION.getStorageUint256();
        // clValidators can never be less than deposited ones.
        assert(depositedValidators >= clValidators);
        return depositedValidators.sub(clValidators).mul(DEPOSIT_SIZE);
    }

    /**
     * @dev Gets the total amount of Ether controlled by the system
     * @return total balance in wei
     */
    function _getTotalPooledEther() internal view returns (uint256) {
        return _getBufferedEther()
            .add(CL_BALANCE_POSITION.getStorageUint256())
            .add(_getTransientBalance());
    }

    function _pauseStaking() internal {
        STAKING_STATE_POSITION.setStorageStakeLimitStruct(
            STAKING_STATE_POSITION.getStorageStakeLimitStruct().setStakeLimitPauseState(true)
        );

        emit StakingPaused();
    }

    function _resumeStaking() internal {
        STAKING_STATE_POSITION.setStorageStakeLimitStruct(
            STAKING_STATE_POSITION.getStorageStakeLimitStruct().setStakeLimitPauseState(false)
        );

        emit StakingResumed();
    }

    function _getCurrentStakeLimit(StakeLimitState.Data memory _stakeLimitData) internal view returns (uint256) {
        if (_stakeLimitData.isStakingPaused()) {
            return 0;
        }
        if (!_stakeLimitData.isStakingLimitSet()) {
            return uint256(-1);
        }

        return _stakeLimitData.calculateCurrentStakeLimit();
    }

    /**
     * @dev Set max positive token rebase value
     * @param _maxPositiveTokenRebase max positive token rebase, nominated in MAX_POSITIVE_REBASE_PRECISION_POINTS
     */
    function _setMaxPositiveTokenRebase(uint256 _maxPositiveTokenRebase) internal {
        require(_maxPositiveTokenRebase <= TOKEN_REBASE_PRECISION_BASE, "WRONG_MAX_TOKEN_POSITIVE_REBASE");

        MAX_POSITIVE_TOKEN_REBASE_POSITION.setStorageUint256(_maxPositiveTokenRebase);

        emit MaxPositiveTokenRebaseSet(_maxPositiveTokenRebase);
    }

    /**
     * @dev Size-efficient analog of the `auth(_role)` modifier
     * @param _role Permission name
     */
    function _auth(bytes32 _role) internal view auth(_role) {
        // no-op
    }

    /**
     * @dev Invokes a deposit call to the Staking Router contract and updates buffered counters
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata module calldata
     */
    function deposit(uint256 _maxDepositsCount, uint256 _stakingModuleId, bytes _depositCalldata) external {
        require(msg.sender == getDepositSecurityModule(), "APP_AUTH_DSM_FAILED");
        require(_stakingModuleId <= uint24(-1), "STAKING_MODULE_ID_TOO_LARGE");
        _whenNotStopped();
        require(!_isBunkerMode(), "CANT_DEPOSIT_IN_BUNKER_MODE");

        uint256 bufferedEth = _getBufferedEther();
        // we dont deposit funds that will go to withdrawals
        uint256 withdrawalReserve = IWithdrawalQueue(getWithdrawalQueue()).unfinalizedStETH();

        if (bufferedEth > withdrawalReserve) {
            bufferedEth = bufferedEth.sub(withdrawalReserve);
            /// available ether amount for deposits (multiple of 32eth)
            uint256 depositableEth = _min(bufferedEth.div(DEPOSIT_SIZE), _maxDepositsCount).mul(DEPOSIT_SIZE);

            uint256 unaccountedEth = _getUnaccountedEther();
            /// @dev transfer ether to SR and make deposit at the same time
            /// @notice allow zero value of depositableEth, in this case SR will simply transfer the unaccounted ether to Lido contract
            uint256 depositedKeysCount = getStakingRouter().deposit.value(depositableEth)(
                _maxDepositsCount,
                _stakingModuleId,
                _depositCalldata
            );
            assert(depositedKeysCount <= depositableEth / DEPOSIT_SIZE );

            if (depositedKeysCount > 0) {
                uint256 depositedAmount = depositedKeysCount.mul(DEPOSIT_SIZE);
                DEPOSITED_VALIDATORS_POSITION.setStorageUint256(DEPOSITED_VALIDATORS_POSITION.getStorageUint256().add(depositedKeysCount));

                _markAsUnbuffered(depositedAmount);
                assert(_getUnaccountedEther() == unaccountedEth);
            }
        }
    }

    function _handleOracleReport(
        OracleReportInputData memory _inputData
    ) internal returns (
        uint256 postTotalPooledEther,
        uint256 postTotalShares,
        uint256 withdrawals,
        uint256 elRewards
    ) {
        _handleBunkerMode(_inputData.isBunkerMode);

        int256 clBalanceDiff = _processClStateUpdate(_inputData.clValidators, _inputData.clBalance);
        uint256 preBufferedEther = _getBufferedEther();

        LimiterState.Data memory tokenRebaseLimiter = _prepareTokenRebase();
        tokenRebaseLimiter.applyCLBalanceUpdate(clBalanceDiff);
        withdrawals = tokenRebaseLimiter.appendEther(_inputData.withdrawalVaultBalance);
        elRewards = tokenRebaseLimiter.appendEther(_inputData.elRewardsVaultBalance);

        // collect ETH from EL and Withdrawal vaults and send some to WithdrawalQueue if required
        _processETHDistribution(
            withdrawals,
            elRewards,
            _inputData.requestIdToFinalizeUpTo,
            _inputData.finalizationShareRate
        );

        // distribute rewards to Lido and Node Operators
        uint256 sharesMintedAsFees = _processRewards(clBalanceDiff, withdrawals, elRewards);

        _applyCoverage(tokenRebaseLimiter);

        (
            postTotalPooledEther, postTotalShares
        ) = _completeTokenRebase(
            tokenRebaseLimiter, sharesMintedAsFees, _inputData.reportTimestamp
        );

        emit ETHDistributed(
            _inputData.reportTimestamp,
            clBalanceDiff,
            withdrawals,
            elRewards,
            preBufferedEther,
            _getBufferedEther()
        );
    }

    function _prepareTokenRebase() internal view returns (LimiterState.Data memory)
    {
        uint256 preTotalPooledEther = _getTotalPooledEther();
        uint256 preTotalShares = _getTotalShares();

        address preTokenRebaseReceiver = getPreTokenRebaseReceiver();
        if (preTokenRebaseReceiver != address(0)) {
            IPreTokenRebaseReceiver(preTokenRebaseReceiver).handlePreTokenRebase(
                preTotalShares, preTotalPooledEther
            );
        }

        return PositiveTokenRebaseLimiter.initLimiterState(
            getMaxPositiveTokenRebase(),
            preTotalPooledEther,
            preTotalShares
        );
    }

    function _completeTokenRebase(
        LimiterState.Data memory _tokenRebaseLimiter,
        uint256 _sharesMintedAsFees,
        uint256 _reportTimestamp
    ) internal returns (uint256 postTotalPooledEther, uint256 postTotalShares) {
        uint256 preTotalPooledEther = _tokenRebaseLimiter.totalPooledEther;
        uint256 preTotalShares = _tokenRebaseLimiter.totalShares;

        postTotalPooledEther = _getTotalPooledEther();
        postTotalShares = _getTotalShares();

        uint256 timeElapsed = _reportTimestamp.sub(_getLastOracleReportTimestamp());
        LAST_ORACLE_REPORT_TIMESTAMP_POSITION.setStorageUint256(_reportTimestamp);

        address postTokenRebaseReceiver = getPostTokenRebaseReceiver();
        if (postTokenRebaseReceiver != address(0)) {
            IPostTokenRebaseReceiver(postTokenRebaseReceiver).handlePostTokenRebase(
                preTotalShares,
                preTotalPooledEther,
                postTotalShares,
                postTotalPooledEther,
                _sharesMintedAsFees,
                timeElapsed
            );
        }

        emit TokenRebase(
            _reportTimestamp,
            preTotalShares,
            preTotalPooledEther,
            postTotalShares,
            postTotalPooledEther,
            _sharesMintedAsFees,
            timeElapsed
        );
    }

    function _handleBunkerMode(bool _isBunkerModeNow) internal {
        bool isBunkerModeWasSetBefore = _isBunkerMode();

        // on bunker mode state change
        if (_isBunkerModeNow != isBunkerModeWasSetBefore) {
            // write previous timestamp to enable bunker or max uint to disable
            uint256 newTimestamp = _isBunkerModeNow ? _getLastOracleReportTimestamp() : uint256(-1);
            BUNKER_MODE_SINCE_TIMESTAMP_POSITION.setStorageUint256(newTimestamp);
        }
    }

    function _isBunkerMode() internal view returns (bool isBunkerMode) {
        uint256 bunkerModeSinceTimestamp = BUNKER_MODE_SINCE_TIMESTAMP_POSITION.getStorageUint256();
        isBunkerMode = bunkerModeSinceTimestamp < uint256(-1);
    }

    function _getLastOracleReportTimestamp() internal view returns (uint256) {
        LAST_ORACLE_REPORT_TIMESTAMP_POSITION.getStorageUint256();
    }

    function _applyCoverage(LimiterState.Data memory _tokenRebaseLimiter) internal {
        ISelfOwnedStETHBurner burner = ISelfOwnedStETHBurner(SELF_OWNED_STETH_BURNER_POSITION.getStorageAddress());
        (uint256 coverShares, uint256 nonCoverShares) = burner.getSharesRequestedToBurn();
        uint256 maxSharesToBurn = _tokenRebaseLimiter.deductShares(coverShares.add(nonCoverShares));

        if (maxSharesToBurn > 0) {
            burner.processLidoOracleReport(maxSharesToBurn);
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _signedSub(int256 a, int256 b) internal pure returns (int256 c) {
        c = a - b;
        require(b - a == -c, "MATH_SUB_UNDERFLOW");
    }

    function _signedAdd(int256 a, int256 b) internal pure returns (int256 c) {
        c = a + b;
        require(c - a == b, "MATH_ADD_OVERFLOW");
    }
}
