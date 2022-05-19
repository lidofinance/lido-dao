// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/ILido.sol";
import "./interfaces/INodeOperatorsRegistry.sol";
import "./interfaces/IDepositContract.sol";
import "./interfaces/ILidoExecutionLayerRewardsVault.sol";

import "./StETH.sol";

import "./lib/StakeLimitUtils.sol";


interface IERC721 {
    /// @notice Transfer ownership of an NFT
    /// @param _from The current owner of the NFT
    /// @param _to The new owner
    /// @param _tokenId The NFT to transfer
    function transferFrom(address _from, address _to, uint256 _tokenId) external payable;
}


/**
* @title Liquid staking pool implementation
*
* Lido is an Ethereum 2.0 liquid staking protocol solving the problem of frozen staked Ethers
* until transfers become available in Ethereum 2.0.
* Whitepaper: https://lido.fi/static/Lido:Ethereum-Liquid-Staking.pdf
*
* NOTE: the code below assumes moderate amount of node operators, e.g. up to 200.
*
* Since balances of all token holders change when the amount of total pooled Ether
* changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
* events upon explicit transfer between holders. In contrast, when Lido oracle reports
* rewards, no Transfer events are generated: doing so would require emitting an event
* for each token holder and thus running an unbounded loop.
*
* At the moment withdrawals are not possible in the beacon chain and there's no workaround.
* Pool will be upgraded to an actual implementation when withdrawals are enabled
* (Phase 1.5 or 2 of Eth2 launch, likely late 2022 or 2023).
*/
contract Lido is ILido, StETH, AragonApp {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;
    using StakeLimitUnstructuredStorage for bytes32;
    using StakeLimitUtils for StakeLimitState.Data;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 constant public STAKING_PAUSE_ROLE = keccak256("STAKING_PAUSE_ROLE");
    bytes32 constant public STAKING_CONTROL_ROLE = keccak256("STAKING_CONTROL_ROLE");
    bytes32 constant public MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 constant public MANAGE_WITHDRAWAL_KEY = keccak256("MANAGE_WITHDRAWAL_KEY");
    bytes32 constant public MANAGE_PROTOCOL_CONTRACTS_ROLE = keccak256("MANAGE_PROTOCOL_CONTRACTS_ROLE");
    bytes32 constant public BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 constant public DEPOSIT_ROLE = keccak256("DEPOSIT_ROLE");
    bytes32 constant public SET_EL_REWARDS_VAULT_ROLE = keccak256("SET_EL_REWARDS_VAULT_ROLE");
    bytes32 constant public SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE = keccak256(
        "SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE"
    );

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

    uint256 constant public DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    /// @dev default value for maximum number of Ethereum 2.0 validators registered in a single depositBufferedEther call
    uint256 internal constant DEFAULT_MAX_DEPOSITS_PER_CALL = 150;

    bytes32 internal constant FEE_POSITION = keccak256("lido.Lido.fee");
    bytes32 internal constant TREASURY_FEE_POSITION = keccak256("lido.Lido.treasuryFee");
    bytes32 internal constant INSURANCE_FEE_POSITION = keccak256("lido.Lido.insuranceFee");
    bytes32 internal constant NODE_OPERATORS_FEE_POSITION = keccak256("lido.Lido.nodeOperatorsFee");

    bytes32 internal constant DEPOSIT_CONTRACT_POSITION = keccak256("lido.Lido.depositContract");
    bytes32 internal constant ORACLE_POSITION = keccak256("lido.Lido.oracle");
    bytes32 internal constant NODE_OPERATORS_REGISTRY_POSITION = keccak256("lido.Lido.nodeOperatorsRegistry");
    bytes32 internal constant TREASURY_POSITION = keccak256("lido.Lido.treasury");
    bytes32 internal constant INSURANCE_FUND_POSITION = keccak256("lido.Lido.insuranceFund");
    bytes32 internal constant EL_REWARDS_VAULT_POSITION = keccak256("lido.Lido.executionLayerRewardsVault");

    /// @dev storage slot position of the staking rate limit structure
    bytes32 internal constant STAKING_STATE_POSITION = keccak256("lido.Lido.stakeLimit");
    /// @dev amount of Ether (on the current Ethereum side) buffered on this smart contract balance
    bytes32 internal constant BUFFERED_ETHER_POSITION = keccak256("lido.Lido.bufferedEther");
    /// @dev number of deposited validators (incrementing counter of deposit operations).
    bytes32 internal constant DEPOSITED_VALIDATORS_POSITION = keccak256("lido.Lido.depositedValidators");
    /// @dev total amount of Beacon-side Ether (sum of all the balances of Lido validators)
    bytes32 internal constant BEACON_BALANCE_POSITION = keccak256("lido.Lido.beaconBalance");
    /// @dev number of Lido's validators available in the Beacon state
    bytes32 internal constant BEACON_VALIDATORS_POSITION = keccak256("lido.Lido.beaconValidators");

    /// @dev percent in basis points of total pooled ether allowed to withdraw from LidoExecutionLayerRewardsVault per LidoOracle report
    bytes32 internal constant EL_REWARDS_WITHDRAWAL_LIMIT_POSITION = keccak256("lido.Lido.ELRewardsWithdrawalLimit");

    /// @dev Just a counter of total amount of execution layer rewards received by Lido contract
    /// Not used in the logic
    bytes32 internal constant TOTAL_EL_REWARDS_COLLECTED_POSITION = keccak256("lido.Lido.totalELRewardsCollected");

    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes32 internal constant WITHDRAWAL_CREDENTIALS_POSITION = keccak256("lido.Lido.withdrawalCredentials");

    /**
    * @dev As AragonApp, Lido contract must be initialized with following variables:
    * @param _depositContract official ETH2 Deposit contract
    * @param _oracle oracle contract
    * @param _operators instance of Node Operators Registry
    * @param _treasury treasury contract
    * @param _insuranceFund insurance fund contract
    * NB: by default, staking and the whole Lido pool are in paused state
    */
    function initialize(
        IDepositContract _depositContract,
        address _oracle,
        INodeOperatorsRegistry _operators,
        address _treasury,
        address _insuranceFund
    )
        public onlyInit
    {
        NODE_OPERATORS_REGISTRY_POSITION.setStorageAddress(address(_operators));
        DEPOSIT_CONTRACT_POSITION.setStorageAddress(address(_depositContract));

        _setProtocolContracts(_oracle, _treasury, _insuranceFund);

        initialized();
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
            STAKING_STATE_POSITION.getStorageStakeLimitStruct().setStakingLimit(
                _maxStakeLimit,
                _stakeLimitIncreasePerBlock
            )
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

        STAKING_STATE_POSITION.setStorageStakeLimitStruct(
            STAKING_STATE_POSITION.getStorageStakeLimitStruct().removeStakingLimit()
        );

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
    function getCurrentStakeLimit() public view returns (uint256) {
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
    function getStakeLimitFullInfo() external view returns (
        bool isStakingPaused,
        bool isStakingLimitSet,
        uint256 currentStakeLimit,
        uint256 maxStakeLimit,
        uint256 maxStakeLimitGrowthBlocks,
        uint256 prevStakeLimit,
        uint256 prevStakeBlockNumber
    ) {
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
    * Unlike vanilla Eth2.0 Deposit contract, accepting only 32-Ether transactions, Lido
    * accepts payments of any size. Submitted Ethers are stored in Buffer until someone calls
    * depositBufferedEther() and pushes them to the ETH2 Deposit contract.
    */
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

        TOTAL_EL_REWARDS_COLLECTED_POSITION.setStorageUint256(
            TOTAL_EL_REWARDS_COLLECTED_POSITION.getStorageUint256().add(msg.value));

        emit ELRewardsReceived(msg.value);
    }

    /**
    * @notice Deposits buffered ethers to the official DepositContract.
    * @dev This function is separated from submit() to reduce the cost of sending funds.
    */
    function depositBufferedEther() external {
        _auth(DEPOSIT_ROLE);

        return _depositBufferedEther(DEFAULT_MAX_DEPOSITS_PER_CALL);
    }

    /**
    * @notice Deposits buffered ethers to the official DepositContract, making no more than `_maxDeposits` deposit calls.
    * @dev This function is separated from submit() to reduce the cost of sending funds.
    */
    function depositBufferedEther(uint256 _maxDeposits) external {
        _auth(DEPOSIT_ROLE);

        return _depositBufferedEther(_maxDeposits);
    }

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
    * @notice Set fee rate to `_feeBasisPoints` basis points.
    * The fees are accrued when:
    * - oracles report staking results (beacon chain balance increase)
    * - validators gain execution layer rewards (priority fees and MEV)
    * @param _feeBasisPoints Fee rate, in basis points
    */
    function setFee(uint16 _feeBasisPoints) external {
        _auth(MANAGE_FEE);

        _setBPValue(FEE_POSITION, _feeBasisPoints);
        emit FeeSet(_feeBasisPoints);
    }

    /**
    * @notice Set fee distribution
    * @param _treasuryFeeBasisPoints basis points go to the treasury,
    * @param _insuranceFeeBasisPoints basis points go to the insurance fund,
    * @param _operatorsFeeBasisPoints basis points go to node operators.
    * @dev The sum has to be 10 000.
    */
    function setFeeDistribution(
        uint16 _treasuryFeeBasisPoints,
        uint16 _insuranceFeeBasisPoints,
        uint16 _operatorsFeeBasisPoints
    )
        external
    {
        _auth(MANAGE_FEE);

        require(
            TOTAL_BASIS_POINTS == uint256(_treasuryFeeBasisPoints)
            .add(uint256(_insuranceFeeBasisPoints))
            .add(uint256(_operatorsFeeBasisPoints)),
            "FEES_DONT_ADD_UP"
        );

        _setBPValue(TREASURY_FEE_POSITION, _treasuryFeeBasisPoints);
        _setBPValue(INSURANCE_FEE_POSITION, _insuranceFeeBasisPoints);
        _setBPValue(NODE_OPERATORS_FEE_POSITION, _operatorsFeeBasisPoints);

        emit FeeDistributionSet(_treasuryFeeBasisPoints, _insuranceFeeBasisPoints, _operatorsFeeBasisPoints);
    }

    /**
    * @notice Set Lido protocol contracts (oracle, treasury, insurance fund).
    *
    * @dev Oracle contract specified here is allowed to make
    * periodical updates of beacon stats
    * by calling pushBeacon. Treasury contract specified here is used
    * to accumulate the protocol treasury fee. Insurance fund contract
    * specified here is used to accumulate the protocol insurance fee.
    *
    * @param _oracle oracle contract
    * @param _treasury treasury contract
    * @param _insuranceFund insurance fund contract
    */
    function setProtocolContracts(
        address _oracle,
        address _treasury,
        address _insuranceFund
    ) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);

        _setProtocolContracts(_oracle, _treasury, _insuranceFund);
    }

    /**
    * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
    * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
    * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
    */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external {
        _auth(MANAGE_WITHDRAWAL_KEY);

        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);
        getOperators().trimUnusedKeys();

        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /**
    * @dev Sets the address of LidoExecutionLayerRewardsVault contract
    * @param _executionLayerRewardsVault Execution layer rewards vault contract address
    */
    function setELRewardsVault(address _executionLayerRewardsVault) external {
        _auth(SET_EL_REWARDS_VAULT_ROLE);

        EL_REWARDS_VAULT_POSITION.setStorageAddress(_executionLayerRewardsVault);

        emit ELRewardsVaultSet(_executionLayerRewardsVault);
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
    * @notice Updates beacon stats, collects rewards from LidoExecutionLayerRewardsVault and distributes all rewards if beacon balance increased
    * @dev periodically called by the Oracle contract
    * @param _beaconValidators number of Lido's keys in the beacon state
    * @param _beaconBalance summarized balance of Lido-controlled keys in wei
    */
    function handleOracleReport(uint256 _beaconValidators, uint256 _beaconBalance) external whenNotStopped {
        require(msg.sender == getOracle(), "APP_AUTH_FAILED");

        uint256 depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        require(_beaconValidators <= depositedValidators, "REPORTED_MORE_DEPOSITED");

        uint256 beaconValidators = BEACON_VALIDATORS_POSITION.getStorageUint256();
        // Since the calculation of funds in the ingress queue is based on the number of validators
        // that are in a transient state (deposited but not seen on beacon yet), we can't decrease the previously
        // reported number (we'll be unable to figure out who is in the queue and count them).
        // See LIP-1 for details https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-1.md
        require(_beaconValidators >= beaconValidators, "REPORTED_LESS_VALIDATORS");
        uint256 appearedValidators = _beaconValidators.sub(beaconValidators);

        // RewardBase is the amount of money that is not included in the reward calculation
        // Just appeared validators * 32 added to the previously reported beacon balance
        uint256 rewardBase = (appearedValidators.mul(DEPOSIT_SIZE)).add(BEACON_BALANCE_POSITION.getStorageUint256());

        // Save the current beacon balance and validators to
        // calculate rewards on the next push
        BEACON_BALANCE_POSITION.setStorageUint256(_beaconBalance);
        BEACON_VALIDATORS_POSITION.setStorageUint256(_beaconValidators);

        // If LidoExecutionLayerRewardsVault address is not set just do as if there were no execution layer rewards at all
        // Otherwise withdraw all rewards and put them to the buffer
        // Thus, execution layer rewards are handled the same way as beacon rewards

        uint256 executionLayerRewards;
        address executionLayerRewardsVaultAddress = getELRewardsVault();

        if (executionLayerRewardsVaultAddress != address(0)) {
            executionLayerRewards = ILidoExecutionLayerRewardsVault(executionLayerRewardsVaultAddress).withdrawRewards(
                (_getTotalPooledEther() * EL_REWARDS_WITHDRAWAL_LIMIT_POSITION.getStorageUint256()) / TOTAL_BASIS_POINTS
            );

            if (executionLayerRewards != 0) {
                BUFFERED_ETHER_POSITION.setStorageUint256(_getBufferedEther().add(executionLayerRewards));
            }
        }

        // Don’t mint/distribute any protocol fee on the non-profitable Lido oracle report
        // (when beacon chain balance delta is zero or negative).
        // See ADR #3 for details: https://research.lido.fi/t/rewards-distribution-after-the-merge-architecture-decision-record/1535
        if (_beaconBalance > rewardBase) {
            uint256 rewards = _beaconBalance.sub(rewardBase);
            distributeFee(rewards.add(executionLayerRewards));
        }
    }

    /**
    * @notice Send funds to recovery Vault. Overrides default AragonApp behaviour
    * @param _token Token to be sent to recovery vault
    */
    function transferToVault(address _token) external {
        require(allowRecoverability(_token), "RECOVER_DISALLOWED");
        address vault = getRecoveryVault();
        require(vault != address(0), "RECOVER_VAULT_ZERO");

        uint256 balance;
        if (_token == ETH) {
            balance = _getUnaccountedEther();
            // Transfer replaced by call to prevent transfer gas amount issue
            require(vault.call.value(balance)(), "RECOVER_TRANSFER_FAILED");
        } else {
            ERC20 token = ERC20(_token);
            balance = token.staticBalanceOf(this);
            // safeTransfer comes from overridden default implementation
            require(token.safeTransfer(vault, balance), "RECOVER_TOKEN_TRANSFER_FAILED");
        }

        emit RecoverToVault(vault, _token, balance);
    }

    /**
    * @notice Returns staking rewards fee rate
    */
    function getFee() public view returns (uint16 feeBasisPoints) {
        return uint16(FEE_POSITION.getStorageUint256());
    }

    /**
    * @notice Returns fee distribution proportion
    */
    function getFeeDistribution()
        public
        view
        returns (
            uint16 treasuryFeeBasisPoints,
            uint16 insuranceFeeBasisPoints,
            uint16 operatorsFeeBasisPoints
        )
    {
        treasuryFeeBasisPoints = uint16(TREASURY_FEE_POSITION.getStorageUint256());
        insuranceFeeBasisPoints = uint16(INSURANCE_FEE_POSITION.getStorageUint256());
        operatorsFeeBasisPoints = uint16(NODE_OPERATORS_FEE_POSITION.getStorageUint256());
    }

    /**
    * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
    */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return WITHDRAWAL_CREDENTIALS_POSITION.getStorageBytes32();
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
    * @notice Gets deposit contract handle
    */
    function getDepositContract() public view returns (IDepositContract) {
        return IDepositContract(DEPOSIT_CONTRACT_POSITION.getStorageAddress());
    }

    /**
    * @notice Gets authorized oracle address
    * @return address of oracle contract
    */
    function getOracle() public view returns (address) {
        return ORACLE_POSITION.getStorageAddress();
    }

    /**
    * @notice Gets node operators registry interface handle
    */
    function getOperators() public view returns (INodeOperatorsRegistry) {
        return INodeOperatorsRegistry(NODE_OPERATORS_REGISTRY_POSITION.getStorageAddress());
    }

    /**
    * @notice Returns the treasury address
    */
    function getTreasury() public view returns (address) {
        return TREASURY_POSITION.getStorageAddress();
    }

    /**
    * @notice Returns the insurance fund address
    */
    function getInsuranceFund() public view returns (address) {
        return INSURANCE_FUND_POSITION.getStorageAddress();
    }

    /**
    * @notice Returns the key values related to Beacon-side
    * @return depositedValidators - number of deposited validators
    * @return beaconValidators - number of Lido's validators visible in the Beacon state, reported by oracles
    * @return beaconBalance - total amount of Beacon-side Ether (sum of all the balances of Lido validators)
    */
    function getBeaconStat() public view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance) {
        depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        beaconValidators = BEACON_VALIDATORS_POSITION.getStorageUint256();
        beaconBalance = BEACON_BALANCE_POSITION.getStorageUint256();
    }

    /**
    * @notice Returns address of the contract set as LidoExecutionLayerRewardsVault
    */
    function getELRewardsVault() public view returns (address) {
        return EL_REWARDS_VAULT_POSITION.getStorageAddress();
    }

    /**
    * @dev Internal function to set authorized oracle address
    * @param _oracle oracle contract
    */
    function _setProtocolContracts(address _oracle, address _treasury, address _insuranceFund) internal {
        require(_oracle != address(0), "ORACLE_ZERO_ADDRESS");
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");
        require(_insuranceFund != address(0), "INSURANCE_FUND_ZERO_ADDRESS");

        ORACLE_POSITION.setStorageAddress(_oracle);
        TREASURY_POSITION.setStorageAddress(_treasury);
        INSURANCE_FUND_POSITION.setStorageAddress(_insuranceFund);

        emit ProtocolContactsSet(_oracle, _treasury, _insuranceFund);
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

            STAKING_STATE_POSITION.setStorageStakeLimitStruct(
                stakeLimitData.updatePrevStakeLimit(currentStakeLimit - msg.value)
            );
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

    /**
    * @dev Deposits buffered eth to the DepositContract and assigns chunked deposits to node operators
    */
    function _depositBufferedEther(uint256 _maxDeposits) internal whenNotStopped {
        uint256 buffered = _getBufferedEther();
        if (buffered >= DEPOSIT_SIZE) {
            uint256 unaccounted = _getUnaccountedEther();
            uint256 numDeposits = buffered.div(DEPOSIT_SIZE);
            _markAsUnbuffered(_ETH2Deposit(numDeposits < _maxDeposits ? numDeposits : _maxDeposits));
            assert(_getUnaccountedEther() == unaccounted);
        }
    }

    /**
    * @dev Performs deposits to the ETH 2.0 side
    * @param _numDeposits Number of deposits to perform
    * @return actually deposited Ether amount
    */
    function _ETH2Deposit(uint256 _numDeposits) internal returns (uint256) {
        (bytes memory pubkeys, bytes memory signatures) = getOperators().assignNextSigningKeys(_numDeposits);

        if (pubkeys.length == 0) {
            return 0;
        }

        require(pubkeys.length.mod(PUBKEY_LENGTH) == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length.mod(SIGNATURE_LENGTH) == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint256 numKeys = pubkeys.length.div(PUBKEY_LENGTH);
        require(numKeys == signatures.length.div(SIGNATURE_LENGTH), "REGISTRY_INCONSISTENT_SIG_COUNT");

        for (uint256 i = 0; i < numKeys; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        DEPOSITED_VALIDATORS_POSITION.setStorageUint256(
            DEPOSITED_VALIDATORS_POSITION.getStorageUint256().add(numKeys)
        );

        return numKeys.mul(DEPOSIT_SIZE);
    }

    /**
    * @dev Invokes a deposit call to the official Deposit contract
    * @param _pubkey Validator to stake for
    * @param _signature Signature of the deposit call
    */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        require(withdrawalCredentials != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositAmount = value.div(DEPOSIT_AMOUNT_UNIT);
        assert(depositAmount.mul(DEPOSIT_AMOUNT_UNIT) == value);    // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
        bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH.sub(64))))
            )
        );

        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance.sub(value);

        getDepositContract().deposit.value(value)(
            _pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }

    /**
    * @dev Distributes fee portion of the rewards by minting and distributing corresponding amount of liquid tokens.
    * @param _totalRewards Total rewards accrued on the Ethereum 2.0 side in wei
    */
    function distributeFee(uint256 _totalRewards) internal {
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
        // shares2mint * newShareCost = (_totalRewards * feeBasis) / TOTAL_BASIS_POINTS
        // newShareCost = newTotalPooledEther / (prevTotalShares + shares2mint)
        //
        // which follows to:
        //
        //                        _totalRewards * feeBasis * prevTotalShares
        // shares2mint = --------------------------------------------------------------
        //                 (newTotalPooledEther * TOTAL_BASIS_POINTS) - (feeBasis * _totalRewards)
        //
        // The effect is that the given percentage of the reward goes to the fee recipient, and
        // the rest of the reward is distributed between token holders proportionally to their
        // token shares.
        uint256 feeBasis = getFee();
        uint256 shares2mint = (
            _totalRewards.mul(feeBasis).mul(_getTotalShares())
            .div(
                _getTotalPooledEther().mul(TOTAL_BASIS_POINTS)
                .sub(feeBasis.mul(_totalRewards))
            )
        );

        // Mint the calculated amount of shares to this contract address. This will reduce the
        // balances of the holders, as if the fee was taken in parts from each of them.
        _mintShares(address(this), shares2mint);

        (,uint16 insuranceFeeBasisPoints, uint16 operatorsFeeBasisPoints) = getFeeDistribution();

        uint256 toInsuranceFund = shares2mint.mul(insuranceFeeBasisPoints).div(TOTAL_BASIS_POINTS);
        address insuranceFund = getInsuranceFund();
        _transferShares(address(this), insuranceFund, toInsuranceFund);
        _emitTransferAfterMintingShares(insuranceFund, toInsuranceFund);

        uint256 distributedToOperatorsShares = _distributeNodeOperatorsReward(
            shares2mint.mul(operatorsFeeBasisPoints).div(TOTAL_BASIS_POINTS)
        );

        // Transfer the rest of the fee to treasury
        uint256 toTreasury = shares2mint.sub(toInsuranceFund).sub(distributedToOperatorsShares);

        address treasury = getTreasury();
        _transferShares(address(this), treasury, toTreasury);
        _emitTransferAfterMintingShares(treasury, toTreasury);
    }

    /**
    *  @dev Internal function to distribute reward to node operators
    *  @param _sharesToDistribute amount of shares to distribute
    *  @return actual amount of shares that was transferred to node operators as a reward
    */
    function _distributeNodeOperatorsReward(uint256 _sharesToDistribute) internal returns (uint256 distributed) {
        (address[] memory recipients, uint256[] memory shares) = getOperators().getRewardsDistribution(_sharesToDistribute);

        assert(recipients.length == shares.length);

        distributed = 0;
        for (uint256 idx = 0; idx < recipients.length; ++idx) {
            _transferShares(
                address(this),
                recipients[idx],
                shares[idx]
            );
            _emitTransferAfterMintingShares(recipients[idx], shares[idx]);
            distributed = distributed.add(shares[idx]);
        }
    }

    /**
    * @dev Records a deposit to the deposit_contract.deposit function
    * @param _amount Total amount deposited to the ETH 2.0 side
    */
    function _markAsUnbuffered(uint256 _amount) internal {
        BUFFERED_ETHER_POSITION.setStorageUint256(
            BUFFERED_ETHER_POSITION.getStorageUint256().sub(_amount));

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
        uint256 buffered = BUFFERED_ETHER_POSITION.getStorageUint256();
        assert(address(this).balance >= buffered);

        return buffered;
    }

    /**
    * @dev Gets unaccounted (excess) Ether on this contract balance
    */
    function _getUnaccountedEther() internal view returns (uint256) {
        return address(this).balance.sub(_getBufferedEther());
    }

    /**
    * @dev Calculates and returns the total base balance (multiple of 32) of validators in transient state,
    *      i.e. submitted to the official Deposit contract but not yet visible in the beacon state.
    * @return transient balance in wei (1e-18 Ether)
    */
    function _getTransientBalance() internal view returns (uint256) {
        uint256 depositedValidators = DEPOSITED_VALIDATORS_POSITION.getStorageUint256();
        uint256 beaconValidators = BEACON_VALIDATORS_POSITION.getStorageUint256();
        // beaconValidators can never be less than deposited ones.
        assert(depositedValidators >= beaconValidators);
        return depositedValidators.sub(beaconValidators).mul(DEPOSIT_SIZE);
    }

    /**
    * @dev Gets the total amount of Ether controlled by the system
    * @return total balance in wei
    */
    function _getTotalPooledEther() internal view returns (uint256) {
        return _getBufferedEther().add(
            BEACON_BALANCE_POSITION.getStorageUint256()
        ).add(_getTransientBalance());
    }

    /**
    * @dev Padding memory array with zeroes up to 64 bytes on the right
    * @param _b Memory array of size 32 .. 64
    */
    function _pad64(bytes memory _b) internal pure returns (bytes memory) {
        assert(_b.length >= 32 && _b.length <= 64);
        if (64 == _b.length)
            return _b;

        bytes memory zero32 = new bytes(32);
        assembly { mstore(add(zero32, 0x20), 0) }

        if (32 == _b.length)
            return BytesLib.concat(_b, zero32);
        else
            return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64).sub(_b.length)));
    }

    /**
    * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
    * @param _value Number less than `2**64` for compatibility reasons
    */
    function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
        result = 0;
        uint256 temp_value = _value;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (temp_value & 0xFF);
            temp_value >>= 8;
        }

        assert(0 == temp_value);    // fully converted
        result <<= (24 * 8);
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

    function _getCurrentStakeLimit(StakeLimitState.Data memory _stakeLimitData) internal view returns(uint256) {
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
}
