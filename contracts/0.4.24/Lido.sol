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

import "./lib/StakeLimitUtils.sol";

import "./StETHPermit.sol";

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

    /// ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant STAKING_PAUSE_ROLE = keccak256("STAKING_PAUSE_ROLE");
    bytes32 public constant STAKING_CONTROL_ROLE = keccak256("STAKING_CONTROL_ROLE");
    bytes32 public constant MANAGE_PROTOCOL_CONTRACTS_ROLE = keccak256("MANAGE_PROTOCOL_CONTRACTS_ROLE");
    bytes32 public constant BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 public constant SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE = keccak256("SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE");

    uint256 private constant DEPOSIT_SIZE = 32 ether;
    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    bytes32 internal constant ORACLE_POSITION = keccak256("lido.Lido.oracle");
    bytes32 internal constant TREASURY_POSITION = keccak256("lido.Lido.treasury");
    bytes32 internal constant EL_REWARDS_VAULT_POSITION = keccak256("lido.Lido.executionLayerRewardsVault");
    bytes32 internal constant STAKING_ROUTER_POSITION = keccak256("lido.Lido.stakingRouter");
    bytes32 internal constant DEPOSIT_SECURITY_MODULE_POSITION = keccak256("lido.Lido.depositSecurityModule");
    bytes32 internal constant WITHDRAWAL_QUEUE_POSITION = keccak256("lido.Lido.withdrawalQueue");
    bytes32 internal constant WITHDRAWAL_VAULT_POSITION = keccak256("lido.Lido.withdrawalVault");

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
    /// @dev percent in basis points of total pooled ether allowed to withdraw from LidoExecutionLayerRewardsVault per LidoOracle report
    bytes32 internal constant EL_REWARDS_WITHDRAWAL_LIMIT_POSITION = keccak256("lido.Lido.ELRewardsWithdrawalLimit");
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

    // The amount of ETH withdrawn from LidoExecutionLayerRewardsVault contract to Lido contract
    event ELRewardsReceived(uint256 amount);

    // Percent in basis points of total pooled ether allowed to withdraw from LidoExecutionLayerRewardsVault per LidoOracle report
    event ELRewardsWithdrawalLimitSet(uint256 limitPoints);

    // Records a deposit made by a user
    event Submitted(address indexed sender, uint256 amount, address referral);

    // The `amount` of ether was sent to the deposit_contract.deposit function
    event Unbuffered(uint256 amount);

    event WithdrawalsReceived(uint256 amount);

    event DepositSecurityModuleSet(address dsmAddress);

    event StakingRouterSet(address stakingRouterAddress);

    event WithdrawalQueueSet(address withdrawalQueueAddress);

    event WithdrawalVaultSet(address withdrawalVaultAddress);

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
    */
    function initialize(
        address _oracle,
        address _treasury,
        address _stakingRouter,
        address _dsm,
        address _executionLayerRewardsVault,
        address _withdrawalVault,
        address _withdrawalQueue,
        address _eip712StETH
    )
        public onlyInit
    {
        _setProtocolContracts(_oracle, _treasury, _executionLayerRewardsVault);

        _initialize_v2(_stakingRouter, _dsm, _eip712StETH, _withdrawalQueue, _withdrawalVault);
        initialized();
    }

    /**
     * @dev If we are deploying the protocol from scratch there are circular dependencies introduced (StakingRouter and DSM),
     *      so on init stage we need to set `_stakingRouter` and `_dsm` as 0x0, and afterwards use setters for set them correctly
     */
    function _initialize_v2(address _stakingRouter, address _dsm, address _eip712StETH, address _withdrawalQueue, address _withdrawalVault) internal {
        require(_stakingRouter != address(0), "STAKING_ROUTER_ZERO_ADDRESS");
        require(_dsm != address(0), "DSM_ZERO_ADDRESS");
        require(_eip712StETH != address(0), "EIP712_STETH_ZERO_ADDRESS");
        require(_withdrawalQueue != address(0), "WITHDRAWAL_QUEUE_ZERO_ADDRESS");
        require(_withdrawalVault != address(0), "WITHDRAWAL_VAULT_ZERO_ADDRESS");

        STAKING_ROUTER_POSITION.setStorageAddress(_stakingRouter);
        DEPOSIT_SECURITY_MODULE_POSITION.setStorageAddress(_dsm);
        WITHDRAWAL_QUEUE_POSITION.setStorageAddress(_withdrawalQueue);
        WITHDRAWAL_VAULT_POSITION.setStorageAddress(_withdrawalVault);

        CONTRACT_VERSION_POSITION.setStorageUint256(2);

        _initializeEIP712StETH(_eip712StETH);

        emit ContractVersionSet(2);
        emit StakingRouterSet(_stakingRouter);
        emit DepositSecurityModuleSet(_dsm);
        emit WithdrawalQueueSet(_withdrawalQueue);
        emit WithdrawalVaultSet(_withdrawalVault);
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
        address _withdrawalVault
    ) external {
        require(!isPetrified(), "PETRIFIED");
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "WRONG_BASE_VERSION");

        _initialize_v2(_stakingRouter, _dsm, _eip712StETH, _withdrawalQueue, _withdrawalVault);
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

        TOTAL_EL_REWARDS_COLLECTED_POSITION.setStorageUint256(TOTAL_EL_REWARDS_COLLECTED_POSITION.getStorageUint256().add(msg.value));

        emit ELRewardsReceived(msg.value);
    }

    /**
    * @notice A payable function for withdrawals acquisition. Can be called only by WithdrawalVault contract
    * @dev We need a dedicated function because funds received by the default payable function
    * are treated as a user deposit
    */
    function receiveWithdrawals() external payable {
        require(msg.sender == getWithdrawalVault());

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
     * @dev Sets limit on amount of ETH to withdraw from execution layer rewards vault per LidoOracle report
     * @param _limitPoints limit in basis points to amount of ETH to withdraw per LidoOracle report
     */
    function setELRewardsWithdrawalLimit(uint16 _limitPoints) external {
        _auth(SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE);

        _setBPValue(EL_REWARDS_WITHDRAWAL_LIMIT_POSITION, _limitPoints);
        emit ELRewardsWithdrawalLimitSet(_limitPoints);
    }

    /**
    * @notice Updates accounting stats, collects EL rewards and distributes collected rewards if beacon balance increased
    * @dev periodically called by the Oracle contract
    * @param _clValidators number of Lido validators on Consensus Layer
    * @param _clBalance sum of all Lido validators' balances on Consensus Layer
    * @param _withdrawalVaultBalance withdrawal vault balance on Execution Layer for report block
    * @param _elRewardsVaultBalance elRewards vault balance on Execution Layer for report block
    * @param _requestIdToFinalizeUpTo right boundary of requestId range if equals 0, no requests should be finalized
    * @param _finalizationShareRate share rate that should be used for finalization
    *
    * @return totalPooledEther amount of ether in the protocol after report
    * @return totalShares amount of shares in the protocol after report
    */
    function handleOracleReport(
        // CL values
        uint256 _clValidators,
        uint256 _clBalance,
        // EL values
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        // decision
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) external returns (uint256 totalPooledEther, uint256 totalShares){
        require(msg.sender == getOracle(), "APP_AUTH_FAILED");
        _whenNotStopped();

        uint256 preClBalance = CL_BALANCE_POSITION.getStorageUint256();

        // update saved CL stats checking its sanity
        uint256 appearedValidators = _processClStateUpdate(
            _clValidators,
            _clBalance
        );

        // collect ETH from EL and Withdrawal vaults and send some to WithdrawalQueue if required
        uint256 executionLayerRewards = _processETHDistribution(
            _withdrawalVaultBalance,
            _elRewardsVaultBalance,
            _requestIdToFinalizeUpTo,
            _finalizationShareRate
        );

        // TODO: check rebase boundaries
        // TODO: emit a rebase event with sufficient data to calc pre- and post-rebase share rates and APR

        // distribute rewards to Lido and Node Operators
        _processRewards(
            preClBalance,
            _clBalance,
            appearedValidators,
            executionLayerRewards,
            _withdrawalVaultBalance
        );

        totalPooledEther = _getTotalPooledEther();
        totalShares = _getTotalShares();
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
    function getWithdrawalVault() public view returns (address) {
        return WITHDRAWAL_VAULT_POSITION.getStorageAddress();
    }

    function setWithdrawalVault(address _withdrawalVault) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_withdrawalVault != address(0), "WITHDRAWAL_VAULT_ADDRESS_ZERO");

        WITHDRAWAL_VAULT_POSITION.setStorageAddress(_withdrawalVault);

        emit WithdrawalVaultSet(_withdrawalVault);
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
    function getTotalELRewardsCollected() external view returns (uint256) {
        return TOTAL_EL_REWARDS_COLLECTED_POSITION.getStorageUint256();
    }

    /**
     * @notice Get limit in basis points to amount of ETH to withdraw per LidoOracle report
     * @return limit in basis points to amount of ETH to withdraw per LidoOracle report
     */
    function getELRewardsWithdrawalLimit() external view returns (uint256) {
        return EL_REWARDS_WITHDRAWAL_LIMIT_POSITION.getStorageUint256();
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
    ) internal returns (uint256 appearedValidators) {
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

        return _postClValidators.sub(preClValidators);
    }

    /// @dev collect ETH from ELRewardsVault and WithdrawalVault and send to WithdrawalQueue
    function _processETHDistribution(
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) internal returns (uint256 executionLayerRewards) {
        executionLayerRewards = 0;
        address elRewardsVaultAddress = getELRewardsVault();
        // If LidoExecutionLayerRewardsVault address is not set just do as if there were no execution layer rewards at all
        // Otherwise withdraw all rewards and put them to the buffer
        uint256 rewardsLimit = (_getTotalPooledEther() * EL_REWARDS_WITHDRAWAL_LIMIT_POSITION.getStorageUint256()) / TOTAL_BASIS_POINTS;

        executionLayerRewards = ILidoExecutionLayerRewardsVault(elRewardsVaultAddress).withdrawRewards(
            _min(rewardsLimit, _elRewardsVaultBalance)
        );

        if (_withdrawalVaultBalance > 0) {
            // we pull all the accounted ether from WithdrawalVault
            IWithdrawalVault(getWithdrawalVault()).withdrawWithdrawals(_withdrawalVaultBalance);
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
            .add(executionLayerRewards) // Collected from ELVault
            .add(_withdrawalVaultBalance) // Collected from WithdrawalVault
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
        uint256 _preClBalance,
        uint256 _postClBalance,
        uint256 _appearedValidators,
        uint256 _executionLayerRewards,
        uint256 _withdrawalVaultBalance
    ) internal {
        uint256 rewardsBase = (_appearedValidators.mul(DEPOSIT_SIZE)).add(_preClBalance);

        // Don’t mint/distribute any protocol fee on the non-profitable Lido oracle report
        // (when consensus layer balance delta is zero or negative).
        // See ADR #3 for details:
        // https://research.lido.fi/t/rewards-distribution-after-the-merge-architecture-decision-record/1535
        if (_postClBalance.add(_withdrawalVaultBalance) > rewardsBase) {
            uint256 consensusLayerRewards = _postClBalance.add(_withdrawalVaultBalance).sub(rewardsBase);
            _distributeFee(consensusLayerRewards.add(_executionLayerRewards));
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
        require(_executionLayerRewardsVault != address(0), "EL_REWARDS_VAULT_ZERO_ADDRESS");

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

        uint256 sharesAmount = getSharesByPooledEth(msg.value);
        if (sharesAmount == 0) {
            // totalControlledEther is 0: either the first-ever deposit or complete slashing
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
    function _distributeFee(uint256 _totalRewards) internal {
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
            uint256 shares2mint =
                _totalRewards.mul(totalFee).mul(_getTotalShares()).div(
                    _getTotalPooledEther().mul(precisionPoints).sub(_totalRewards.mul(totalFee))
                );

            _mintShares(address(this), shares2mint);

            (uint256[] memory moduleRewards, uint256 totalModuleRewards) =
                _transferModuleRewards(recipients, modulesFees, totalFee, shares2mint);

            _transferTreasuryRewards(shares2mint.sub(totalModuleRewards));

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

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
