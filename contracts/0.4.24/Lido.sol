// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "../common/interfaces/ILidoLocator.sol";
import "../common/interfaces/ISelfOwnedStETHBurner.sol";

import "./lib/StakeLimitUtils.sol";
import "./lib/SafeMathSigned256.sol";
import "../common/lib/Math256.sol";

import "./StETHPermit.sol";

import "./utils/Versioned.sol";

interface IPostTokenRebaseReceiver {
    function handlePostTokenRebase(
        uint256 reportTimestamp,
        uint256 timeElapsed,
        uint256 preTotalShares,
        uint256 preTotalEther,
        uint256 postTotalShares,
        uint256 postTotalEther,
        uint256 sharesMintedAsFees
    ) external;
}

interface IOracleReportSanityChecker {
    function smoothenTokenRebase(
        uint256 _preTotalPooledEther,
        uint256 _preTotalShares,
        int256 _clBalanceDiff,
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance
    ) external view returns (
        uint256 withdrawals,
        uint256 elRewards,
        uint256 sharesToBurnLimit
    );
}

interface ILidoExecutionLayerRewardsVault {
    function withdrawRewards(uint256 _maxAmount) external returns (uint256 amount);
}

interface IWithdrawalVault {
    function withdrawWithdrawals(uint256 _amount) external;
}

interface IStakingRouter {
    function deposit(
        uint256 maxDepositsCount,
        uint256 stakingModuleId,
        bytes depositCalldata
    ) external payable returns (uint256);
    function getStakingRewardsDistribution()
        external
        view
        returns (
            address[] memory recipients,
            uint256[] memory stakingModuleIds,
            uint96[] memory stakingModuleFees,
            uint96 totalFee,
            uint256 precisionPoints
        );
    function getWithdrawalCredentials() external view returns (bytes32);
    function reportRewardsMinted(uint256[] _stakingModuleIds, uint256[] _totalShares) external;
    function getTotalFeeE4Precision() external view returns (uint16 totalFee);
    function getStakingFeeAggregateDistributionE4Precision() external view returns (uint16 modulesFee, uint16 treasuryFee);
}

interface IWithdrawalQueue {
    function finalizationBatch(uint256 _lastRequestIdToFinalize, uint256 _shareRate)
        external
        view
        returns (uint128 eth, uint128 shares);
    function finalize(uint256 _lastIdToFinalize) external payable;
    function isPaused() external view returns (bool);
    function unfinalizedStETH() external view returns (uint256);
    function isBunkerModeActive() external view returns (bool);
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
*
* NB: Order of inheritance must preserve the structured storage layout of the previous versions.
*
* @dev Lido is derived from `StETHPermit` that has a structured storage:
* SLOT 0: mapping (address => uint256) private shares (`StETH`)
* SLOT 1: mapping (address => mapping (address => uint256)) private allowances (`StETH`)
* SLOT 2: mapping(address => uint256) internal noncesByAddress (`StETHPermit`)
*
* `Versioned` and `AragonApp` both don't have the pre-allocated structured storage.
*/
contract Lido is Versioned, StETHPermit, AragonApp {
    using SafeMath for uint256;
    using SafeMathSigned256 for int256;
    using UnstructuredStorage for bytes32;
    using StakeLimitUnstructuredStorage for bytes32;
    using StakeLimitUtils for StakeLimitState.Data;

    /// ACL
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant STAKING_PAUSE_ROLE = keccak256("STAKING_PAUSE_ROLE");
    bytes32 public constant STAKING_CONTROL_ROLE = keccak256("STAKING_CONTROL_ROLE");

    uint256 private constant DEPOSIT_SIZE = 32 ether;
    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    /// @dev storage slot position for the Lido protocol contracts locator
    bytes32 internal constant LIDO_LOCATOR_POSITION = keccak256("lido.Lido.lidoLocator");
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
    /// @dev Just a counter of total amount of execution layer rewards received by Lido contract. Not used in the logic.
    bytes32 internal constant TOTAL_EL_REWARDS_COLLECTED_POSITION = keccak256("lido.Lido.totalELRewardsCollected");

    event Stopped();
    event Resumed();

    event StakingPaused();
    event StakingResumed();
    event StakingLimitSet(uint256 maxStakeLimit, uint256 stakeLimitIncreasePerBlock);
    event StakingLimitRemoved();

    event ETHDistributed(
        uint256 indexed reportTimestamp,
        int256 clBalanceDiff,
        uint256 withdrawalsWithdrawn,
        uint256 executionLayerRewardsWithdrawn,
        uint256 postBufferedEther
    );

    event TokenRebased(
        uint256 indexed reportTimestamp,
        uint256 timeElapsed,
        uint256 preTotalShares,
        uint256 preTotalEther,
        uint256 postTotalShares,
        uint256 postTotalEther,
        uint256 sharesMintedAsFees
    );

    // Lido locator set
    event LidoLocatorSet(address lidoLocator);

    // The amount of ETH withdrawn from LidoExecutionLayerRewardsVault to Lido
    event ELRewardsReceived(uint256 amount);

    // The amount of ETH withdrawn from WithdrawalVault to Lido
    event WithdrawalsReceived(uint256 amount);

    // Records a deposit made by a user
    event Submitted(address indexed sender, uint256 amount, address referral);

    // The `amount` of ether was sent to the deposit_contract.deposit function
    event Unbuffered(uint256 amount);

    // The amount of ETH sended from StakingRouter contract to Lido contract
    event StakingRouterTransferReceived(uint256 amount);

    /**
    * @dev As AragonApp, Lido contract must be initialized with following variables:
    *      NB: by default, staking and the whole Lido pool are in paused state
    * @param _lidoLocator lido locator contract
    * @param _eip712StETH eip712 helper contract for StETH
    */
    function initialize(
        address _lidoLocator,
        address _eip712StETH
    )
        public onlyInit
    {
        _initialize_v2(_lidoLocator, _eip712StETH);
        initialized();
    }

    /**
     * initializer v2
     */
    function _initialize_v2(
        address _lidoLocator,
        address _eip712StETH
    ) internal {
        _setContractVersion(2);

        LIDO_LOCATOR_POSITION.setStorageAddress(_lidoLocator);
        _initializeEIP712StETH(_eip712StETH);

        emit LidoLocatorSet(_lidoLocator);
    }

    /**
     * @notice A function to finalize upgrade to v2 (from v1). Can be called only once
     * @dev Value 1 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
     * For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     */
    function finalizeUpgrade_v2(
        address _lidoLocator,
        address _eip712StETH
    ) external {
        require(hasInitialized(), "NOT_INITIALIZED");
        _checkContractVersion(0);

        require(_lidoLocator != address(0), "LIDO_LOCATOR_ZERO_ADDRESS");
        require(_eip712StETH != address(0), "EIP712_STETH_ZERO_ADDRESS");

        _initialize_v2(_lidoLocator, _eip712StETH);
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
     * @notice A payable function for execution layer rewards. Can be called only by ExecutionLayerRewardsVault
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveELRewards() external payable {

        require(msg.sender == getLidoLocator().elRewardsVault(), "EXECUTION_LAYER_REWARDS_VAULT_ONLY");

        TOTAL_EL_REWARDS_COLLECTED_POSITION.setStorageUint256(getTotalELRewardsCollected().add(msg.value));

        emit ELRewardsReceived(msg.value);
    }

    /**
    * @notice A payable function for withdrawals acquisition. Can be called only by WithdrawalVault
    * @dev We need a dedicated function because funds received by the default payable function
    * are treated as a user deposit
    */
    function receiveWithdrawals() external payable {
        require(msg.sender == getLidoLocator().withdrawalVault());

        emit WithdrawalsReceived(msg.value);
    }

    /**
     * @notice A payable function for staking router deposits 'change'. Can be called only by StakingRouter
     * @dev We need a dedicated function because funds received by the default payable function
     * are treated as a user deposit
     */
    function receiveStakingRouter() external payable {
        require(msg.sender == getLidoLocator().stakingRouter());

        emit StakingRouterTransferReceived(msg.value);
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
     * The structure is used to aggregate the `handleOracleReport` provided data.
     * Using the in-memory structure addresses `stack too deep` issues.
     */
    struct OracleReportInputData {
        // Oracle timings
        uint256 reportTimestamp;
        uint256 timeElapsed;
        // CL values
        uint256 clValidators;
        uint256 clBalance;
        // EL values
        uint256 withdrawalVaultBalance;
        uint256 elRewardsVaultBalance;
        // Decision about withdrawals processing
        uint256 requestIdToFinalizeUpTo;
        uint256 finalizationShareRate;
    }

    /**
    * @notice Updates accounting stats, collects EL rewards and distributes collected rewards if beacon balance increased
    * @dev periodically called by the Oracle contract
    * @param _reportTimestamp the moment of the oracle report calculation
    * @param _timeElapsed seconds elapsed since the previous report calculation
    * @param _clValidators number of Lido validators on Consensus Layer
    * @param _clBalance sum of all Lido validators' balances on Consensus Layer
    * @param _withdrawalVaultBalance withdrawal vault balance on Execution Layer for report block
    * @param _elRewardsVaultBalance elRewards vault balance on Execution Layer for report block
    * @param _requestIdToFinalizeUpTo right boundary of requestId range if equals 0, no requests should be finalized
    * @param _finalizationShareRate share rate that should be used for finalization
    *
    * @return totalPooledEther amount of ether in the protocol after report
    * @return totalShares amount of shares in the protocol after report
    * @return withdrawals withdrawn from the withdrawals vault
    * @return elRewards withdrawn from the execution layer rewards vault
    */
    function handleOracleReport(
        // Oracle timings
        uint256 _reportTimestamp,
        uint256 _timeElapsed,
        // CL values
        uint256 _clValidators,
        uint256 _clBalance,
        // EL values
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        // Decision about withdrawals processing
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) external returns (
        uint256 totalPooledEther,
        uint256 totalShares,
        uint256 withdrawals,
        uint256 elRewards
    ) {
        // TODO: safety checks

        require(msg.sender == getLidoLocator().accountingOracle(), "APP_AUTH_FAILED");
        _whenNotStopped();

        return _handleOracleReport(
            OracleReportInputData(
                _reportTimestamp,
                _timeElapsed,
                _clValidators,
                _clBalance,
                _withdrawalVaultBalance,
                _elRewardsVaultBalance,
                _requestIdToFinalizeUpTo,
                _finalizationShareRate
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
     * @notice Gets authorized oracle address
     * @return address of oracle contract
     */
    function getLidoLocator() public view returns (ILidoLocator) {
        return ILidoLocator(LIDO_LOCATOR_POSITION.getStorageAddress());
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

    /// DEPRECATED PUBLIC METHODS

    /**
     * @notice Returns current withdrawal credentials of deposited validators
     * @dev DEPRECATED: use StakingRouter.getWithdrawalCredentials() instead
     */
    function getWithdrawalCredentials() external view returns (bytes32) {
        return IStakingRouter(getLidoLocator().stakingRouter()).getWithdrawalCredentials();
    }

    /**
     * @notice Returns legacy oracle
     * @dev DEPRECATED: the `AccountingOracle` superseded the old one
     */
    function getOracle() external view returns (address) {
        return getLidoLocator().legacyOracle();
    }

    /**
     * @notice Returns the treasury address
     * @dev DEPRECATED: use LidoLocator.treasury()
     */
    function getTreasury() external view returns (address) {
        return getLidoLocator().treasury();
    }

    /**
     * @notice Returns current staking rewards fee rate (DEPRECATED)
     * @dev Now fees information is stored in StakingRouter and
     * with higher precision. Use StakingRouter.getStakingFeeAggregateDistribution() instead.
     * @return totalFee total rewards fee in 1e4 precision (10000 is 100%). The value might be
     * inaccurate because the actual value is truncated here to 1e4 precision.
     */
    function getFee() external view returns (uint16 totalFee) {
        totalFee = IStakingRouter(getLidoLocator().stakingRouter()).getTotalFeeE4Precision();
    }

    /**
     * @notice Returns current fee distribution (DEPRECATED)
     * @dev Now fees information is stored in StakingRouter and
     * with higher precision. Use StakingRouter.getStakingFeeAggregateDistribution() instead.
     * @return treasuryFeeBasisPoints return treasury fee in TOTAL_BASIS_POINTS (10000 is 100% fee) precision
     * @return insuranceFeeBasisPoints always returns 0 because the capability to send fees to
     * insurance from Lido contract is removed.
     * @return operatorsFeeBasisPoints return total fee for all operators of all staking modules in
     * TOTAL_BASIS_POINTS (10000 is 100% fee) precision.
     * Previously returned total fee of all node operators of NodeOperatorsRegistry (Curated staking module now)
     * The value might be inaccurate because the actual value is truncated here to 1e4 precision.
     */
    function getFeeDistribution()
        external view
        returns (
            uint16 treasuryFeeBasisPoints,
            uint16 insuranceFeeBasisPoints,
            uint16 operatorsFeeBasisPoints
        )
    {
        insuranceFeeBasisPoints = 0;  // explicitly set to zero
        (treasuryFeeBasisPoints, operatorsFeeBasisPoints) = IStakingRouter(getLidoLocator().stakingRouter())
            .getStakingFeeAggregateDistributionE4Precision();
    }

    /*
     * @dev updates Consensus Layer state according to the current report
     *
     * NB: conventions and assumptions
     *
     * `depositedValidators` are total amount of the **ever** deposited validators
     * `_postClValidators` are total amount of the **ever** deposited validators
     *
     * i.e., exited validators persist in the state, just with a different status
     */
    function _processClStateUpdate(
        uint256 _postClValidators,
        uint256 _postClBalance
    ) internal returns (int256 clBalanceDiff) {
        uint256 depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        require(_postClValidators <= depositedValidators, "REPORTED_MORE_DEPOSITED");

        uint256 preClValidators = CL_VALIDATORS_POSITION.getStorageUint256();
        require(_postClValidators >= preClValidators, "REPORTED_LESS_VALIDATORS");


        if (_postClValidators > preClValidators) {
            CL_VALIDATORS_POSITION.setStorageUint256(_postClValidators);
        }

        uint256 appearedValidators = _postClValidators.sub(preClValidators);
        uint256 preCLBalance = CL_BALANCE_POSITION.getStorageUint256();
        // Take into account the balance of the newly appeared validators
        uint256 preCLBalanceWithAppeared = appearedValidators.mul(DEPOSIT_SIZE).add(preCLBalance);

        // Save the current CL balance and validators to
        // calculate rewards on the next push
        CL_BALANCE_POSITION.setStorageUint256(_postClBalance);

        // Find the difference between CL balances (considering appeared validators)
        return int256(_postClBalance).sub(int256(preCLBalanceWithAppeared));
    }

    /**
     * @dev collect ETH from ELRewardsVault and WithdrawalVault, then send to WithdrawalQueue
     */
    function _collectRewardsAndProcessWithdrawals(
        uint256 _withdrawalsToWithdraw,
        uint256 _elRewardsToWithdraw,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) internal {
        (
            address elRewardsVault,
            /* address safetyNetsRegistry */,
            /* address stakingRouter */,
            /* address treasury */,
            address withdrawalQueue,
            address withdrawalVault
        ) = getLidoLocator().coreComponents();

        // withdraw execution layer rewards and put them to the buffer
        if (_elRewardsToWithdraw > 0) {
            ILidoExecutionLayerRewardsVault(elRewardsVault).withdrawRewards(_elRewardsToWithdraw);
        }

        // withdraw withdrawals and put them to the buffer
        if (_withdrawalsToWithdraw > 0) {
            IWithdrawalVault(withdrawalVault).withdrawWithdrawals(_withdrawalsToWithdraw);
        }

        uint256 lockedToWithdrawalQueue = 0;
        if (_requestIdToFinalizeUpTo > 0) {
            lockedToWithdrawalQueue = _processWithdrawalQueue(
                withdrawalQueue,
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

    /**
     * @dev finalize withdrawal requests in the queue, burn their shares and return the amount of ether locked for claiming
     */
    function _processWithdrawalQueue(
        address _withdrawalQueue,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) internal returns (uint256 lockedToWithdrawalQueue) {
        IWithdrawalQueue withdrawalQueue = IWithdrawalQueue(_withdrawalQueue);

        if (withdrawalQueue.isPaused()) return 0;

        (uint256 etherToLock, uint256 sharesToBurn) = withdrawalQueue.finalizationBatch(
            _requestIdToFinalizeUpTo,
            _finalizationShareRate
        );

        _burnShares(address(withdrawalQueue), sharesToBurn);
        withdrawalQueue.finalize.value(etherToLock)(_requestIdToFinalizeUpTo);

        return etherToLock;
    }

    /**
     * @dev calculate the amount of rewards and distribute it
     */
    function _processRewards(
        int256 _clBalanceDiff,
        uint256 _withdrawnWithdrawals,
        uint256 _withdrawnElRewards
    ) internal returns (uint256 sharesMintedAsFees) {
        int256 consensusLayerRewards = _clBalanceDiff.add(int256(_withdrawnWithdrawals));
        // Don’t mint/distribute any protocol fee on the non-profitable Lido oracle report
        // (when consensus layer balance delta is zero or negative).
        // See ADR #3 for details:
        // https://research.lido.fi/t/rewards-distribution-after-the-merge-architecture-decision-record/1535
        if (consensusLayerRewards > 0) {
            sharesMintedAsFees = _distributeFee(uint256(consensusLayerRewards).add(_withdrawnElRewards));
        }
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
        if (_getTotalPooledEther() != 0 && _getTotalShares() != 0) {
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
        IStakingRouter router = IStakingRouter(getLidoLocator().stakingRouter());

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
        address treasury = getLidoLocator().treasury();
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
     * @dev Check that Lido allows depositing
     * Depends on the bunker state and protocol's pause state
     */
    function canDeposit() public view returns (bool) {
       return !IWithdrawalQueue(getLidoLocator().withdrawalQueue()).isBunkerModeActive() && !isStopped();
    }

    /**
     * @dev Invokes a deposit call to the Staking Router contract and updates buffered counters
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata module calldata
     */
    function deposit(uint256 _maxDepositsCount, uint256 _stakingModuleId, bytes _depositCalldata) external {
        ILidoLocator locator = getLidoLocator();

        require(msg.sender == locator.depositSecurityModule(), "APP_AUTH_DSM_FAILED");
        require(_stakingModuleId <= uint24(-1), "STAKING_MODULE_ID_TOO_LARGE");
        require(canDeposit(), "CAN_NOT_DEPOSIT");

        IWithdrawalQueue withdrawalQueue = IWithdrawalQueue(locator.withdrawalQueue());
        require(!withdrawalQueue.isBunkerModeActive(), "CANT_DEPOSIT_IN_BUNKER_MODE");

        uint256 bufferedEth = _getBufferedEther();
        // we dont deposit funds that will go to withdrawals
        uint256 withdrawalReserve = withdrawalQueue.unfinalizedStETH();

        if (bufferedEth > withdrawalReserve) {
            bufferedEth = bufferedEth.sub(withdrawalReserve);
            /// available ether amount for deposits (multiple of 32eth)
            uint256 depositableEth = Math256.min(bufferedEth.div(DEPOSIT_SIZE), _maxDepositsCount).mul(DEPOSIT_SIZE);

            uint256 unaccountedEth = _getUnaccountedEther();
            /// @dev transfer ether to SR and make deposit at the same time
            /// @notice allow zero value of depositableEth, in this case SR will simply transfer the unaccounted ether to Lido contract
            uint256 depositedKeysCount = IStakingRouter(locator.stakingRouter()).deposit.value(depositableEth)(
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
        int256 clBalanceDiff = _processClStateUpdate(_inputData.clValidators, _inputData.clBalance);

        uint256 preTotalPooledEther = _getTotalPooledEther();
        uint256 preTotalShares = _getTotalShares();

        uint256 sharesToBurnLimit;
        (
            withdrawals, elRewards, sharesToBurnLimit
        ) = IOracleReportSanityChecker(getLidoLocator().safetyNetsRegistry()).smoothenTokenRebase(
            preTotalPooledEther,
            preTotalShares,
            clBalanceDiff,
            _inputData.withdrawalVaultBalance,
            _inputData.elRewardsVaultBalance
        );

        // collect ETH from EL and Withdrawal vaults and send some to WithdrawalQueue if required
        _collectRewardsAndProcessWithdrawals(
            withdrawals,
            elRewards,
            _inputData.requestIdToFinalizeUpTo,
            _inputData.finalizationShareRate
        );

        emit ETHDistributed(
            _inputData.reportTimestamp,
            clBalanceDiff,
            withdrawals,
            elRewards,
            _getBufferedEther()
        );

        // distribute rewards to Lido and Node Operators
        uint256 sharesMintedAsFees = _processRewards(clBalanceDiff, withdrawals, elRewards);
        _burnSharesLimited(sharesToBurnLimit);

        (
            postTotalShares,
            postTotalPooledEther
        ) = _completeTokenRebase(
            preTotalShares,
            preTotalPooledEther,
            _inputData.reportTimestamp,
            _inputData.timeElapsed,
            sharesMintedAsFees
        );
    }

    function _completeTokenRebase(
        uint256 _preTotalShares,
        uint256 _preTotalPooledEther,
        uint256 _reportTimestamp,
        uint256 _timeElapsed,
        uint256 _sharesMintedAsFees
    ) internal returns (uint256 postTotalShares, uint256 postTotalPooledEther) {
        postTotalShares = _getTotalShares();
        postTotalPooledEther = _getTotalPooledEther();

        address postTokenRebaseReceiver = getLidoLocator().postTokenRebaseReceiver();
        if (postTokenRebaseReceiver != address(0)) {
            IPostTokenRebaseReceiver(postTokenRebaseReceiver).handlePostTokenRebase(
                _reportTimestamp,
                _timeElapsed,
                _preTotalShares,
                _preTotalPooledEther,
                postTotalShares,
                postTotalPooledEther,
                _sharesMintedAsFees
            );
        }

        emit TokenRebased(
            _reportTimestamp,
            _timeElapsed,
            _preTotalShares,
            _preTotalPooledEther,
            postTotalShares,
            postTotalPooledEther,
            _sharesMintedAsFees
        );
    }

    function _burnSharesLimited(uint256 sharesToBurnLimit) internal {
        if (sharesToBurnLimit > 0) {
            ISelfOwnedStETHBurner burner = ISelfOwnedStETHBurner(
                getLidoLocator().selfOwnedStEthBurner()
            );

            uint256 sharesCommittedToBurnNow = burner.commitSharesToBurn(sharesToBurnLimit);

            if (sharesCommittedToBurnNow > 0) {
                _burnShares(address(burner), sharesCommittedToBurnNow);
            }
        }
    }
}
