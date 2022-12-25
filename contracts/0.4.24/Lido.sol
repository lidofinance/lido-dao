// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/ILido.sol";
import "./interfaces/IDepositContract.sol";
import "./interfaces/ILidoExecutionLayerRewardsVault.sol";
import "./interfaces/IStakingRouter.sol";

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
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant STAKING_PAUSE_ROLE = keccak256("STAKING_PAUSE_ROLE");
    bytes32 public constant STAKING_CONTROL_ROLE = keccak256("STAKING_CONTROL_ROLE");
    bytes32 public constant MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 public constant MANAGE_PROTOCOL_CONTRACTS_ROLE = keccak256("MANAGE_PROTOCOL_CONTRACTS_ROLE");
    bytes32 public constant BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 public constant DEPOSIT_ROLE = keccak256("DEPOSIT_ROLE");
    bytes32 public constant SET_EL_REWARDS_VAULT_ROLE = keccak256("SET_EL_REWARDS_VAULT_ROLE");
    bytes32 public constant SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE = keccak256("SET_EL_REWARDS_WITHDRAWAL_LIMIT_ROLE");

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

    uint256 public constant DEPOSIT_SIZE = 32 ether;

    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    /// @dev default value for maximum number of Ethereum 2.0 validators registered in a single depositBufferedEther call
    uint256 internal constant DEFAULT_MAX_DEPOSITS_PER_CALL = 150;

    bytes32 internal constant MAX_FEE_POSITION = keccak256("lido.Lido.maxFee");

    bytes32 internal constant ORACLE_POSITION = keccak256("lido.Lido.oracle");
    bytes32 internal constant TREASURY_POSITION = keccak256("lido.Lido.treasury");
    bytes32 internal constant EL_REWARDS_VAULT_POSITION = keccak256("lido.Lido.executionLayerRewardsVault");
    bytes32 internal constant STAKING_ROUTER_POSITION = keccak256("lido.Lido.stakingRouter");
    bytes32 internal constant DEPOSIT_SECURITY_MODULE_POSITION = keccak256("lido.Lido.depositSecurityModule");

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
    /// @dev amount of Ether sended to the Staking Router contract balance
    bytes32 internal constant STAKING_ROUTER_BUFFERED_ETHER_POSITION = keccak256("lido.Lido.stakingRouterBufferedEther");

    /// @dev percent in basis points of total pooled ether allowed to withdraw from LidoExecutionLayerRewardsVault per LidoOracle report
    bytes32 internal constant EL_REWARDS_WITHDRAWAL_LIMIT_POSITION = keccak256("lido.Lido.ELRewardsWithdrawalLimit");

    /// @dev Just a counter of total amount of execution layer rewards received by Lido contract
    /// Not used in the logic
    bytes32 internal constant TOTAL_EL_REWARDS_COLLECTED_POSITION = keccak256("lido.Lido.totalELRewardsCollected");

    modifier onlyDsm() {
        require(msg.sender == getDepositSecurityModule(), "APP_AUTH_DSM_FAILED");
        _;
    }

    /**
     * @dev As AragonApp, Lido contract must be initialized with following variables:
     * @param _oracle oracle contract
     * @param _treasury treasury contract
     * NB: by default, staking and the whole Lido pool are in paused state
     */
    function initialize(address _oracle, address _treasury) public onlyInit {
        _setProtocolContracts(_oracle, _treasury);

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
     * Unlike vanilla Eth2.0 Deposit contract, accepting only 32-Ether transactions, Lido
     * accepts payments of any size. Submitted Ethers are stored in Buffer until someone calls
     * deposit() and pushes them to the ETH2 Deposit contract.
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

        TOTAL_EL_REWARDS_COLLECTED_POSITION.setStorageUint256(TOTAL_EL_REWARDS_COLLECTED_POSITION.getStorageUint256().add(msg.value));

        emit ELRewardsReceived(msg.value);
    }

    function burnShares(
        address _account,
        uint256 _sharesAmount
    ) external authP(BURN_ROLE, arr(_account, _sharesAmount)) returns (uint256 newTotalShares) {
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

    function setMaxFee(uint16 _maximumFeeBasisPoints) external {
        _auth(MANAGE_FEE);

        _setBPValue(MAX_FEE_POSITION, _maximumFeeBasisPoints);
        emit MaxFeeSet(_maximumFeeBasisPoints);
    }

    /**
     * @notice Set Lido protocol contracts (oracle, treasury).
     *
     * @dev Oracle contract specified here is allowed to make
     * periodical updates of beacon stats
     * by calling pushBeacon. Treasury contract specified here is used
     * to accumulate the protocol treasury fee.
     *
     * @param _oracle oracle contract
     * @param _treasury treasury contract
     */
    function setProtocolContracts(address _oracle, address _treasury) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);

        _setProtocolContracts(_oracle, _treasury);
        emit ProtocolContactsSet(_oracle, _treasury);
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

    function getMaxFee() public view returns (uint16 maximumFeeBasisPoints) {
        return uint16(MAX_FEE_POSITION.getStorageUint256());
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

    function getStakingRouterBufferedEther() external view returns (uint256) {
        return _getStakingRouterBufferedEther();
    }

    function getTotalBufferedEther() public view returns (uint256) {
        return _getBufferedEther().add(_getStakingRouterBufferedEther());
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
     * @notice Returns current staking rewards fee rate
     */
    function getFee() public view returns (uint16 feeBasisPoints) {
        address stakingRouterAddress = getStakingRouter();
        (, , feeBasisPoints) = IStakingRouter(stakingRouterAddress).getStakingRewardsDistribution();
        return feeBasisPoints;
    }

    /**
     * @notice Returns current fee distribution proportion
     */
    function getFeeDistribution() public view returns (uint16 modulesFeeBasisPoints, uint16 treasuryFeeBasisPoints) {
        address stakingRouterAddress = getStakingRouter();
        (, uint16[] memory moduleFees, uint16 totalFee) = IStakingRouter(stakingRouterAddress).getStakingRewardsDistribution();
        for (uint i; i < moduleFees.length; ++i) {
            modulesFeeBasisPoints += moduleFees[i];
        }
        treasuryFeeBasisPoints = totalFee - modulesFeeBasisPoints;
    }

     /**
    * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
    */
    function getWithdrawalCredentials() external view returns (bytes32) {
        address stakingRouterAddress = getStakingRouter();
        require(stakingRouterAddress != address(0), "STAKING_ROUTER_ADDRESS_ZERO");
        return IStakingRouter(stakingRouterAddress).getWithdrawalCredentials();
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
    function _setProtocolContracts(address _oracle, address _treasury) internal {
        require(_oracle != address(0), "ORACLE_ZERO_ADDRESS");
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");

        ORACLE_POSITION.setStorageAddress(_oracle);
        TREASURY_POSITION.setStorageAddress(_treasury);

        emit ProtocolContactsSet(_oracle, _treasury);
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

    function getStakingRouter() public view returns (address) {
        return STAKING_ROUTER_POSITION.getStorageAddress();
    }

    function setStakingRouter(address _stakingRouterAddress) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_stakingRouterAddress != address(0), "STAKING_ROUTER_ADDRESS_ZERO");
        STAKING_ROUTER_POSITION.setStorageAddress(_stakingRouterAddress);

        emit StakingRouterSet(_stakingRouterAddress);
    }

    function getDepositSecurityModule() public view returns (address) {
        return DEPOSIT_SECURITY_MODULE_POSITION.getStorageAddress();
    }

    function setDepositSecurityModule(address _dsmAddress) external {
        _auth(MANAGE_PROTOCOL_CONTRACTS_ROLE);
        require(_dsmAddress != address(0), "DSM_ADDRESS_ZERO");
        DEPOSIT_SECURITY_MODULE_POSITION.setStorageAddress(_dsmAddress);

        emit DepositSecurityModuleSet(_dsmAddress);
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

        address stakingRouterAddress = getStakingRouter();

        (address[] memory recipients, uint16[] memory moduleFees, uint16 totalFee) = IStakingRouter(stakingRouterAddress)
            .getStakingRewardsDistribution();

        require(recipients.length > 0, "NO_RECIPIENTS");
        require(totalFee > 0, "NOTHING_TO_DISTRIBUTE");
        require(totalFee <= getMaxFee(), "TOTAL_FEE_EXCEED_MAXIMUM_FEE");

        uint256 shares2mint = _totalRewards.mul(totalFee).mul(_getTotalShares()).div(
            _getTotalPooledEther().mul(TOTAL_BASIS_POINTS).sub(_totalRewards.mul(totalFee))
        );

        _mintShares(address(this), shares2mint);

        uint256 treasuryReward = shares2mint;
        uint256 moduleReward;

        for (uint256 i = 0; i < recipients.length; i++) {
            moduleReward = shares2mint.mul(moduleFees[i]).div(totalFee);
            if (moduleReward > 0) {
                _transferShares(address(this), recipients[i], moduleReward);
                treasuryReward -= moduleReward;
            }
        }

        address treasury = getTreasury();

        _transferShares(address(this), treasury, treasuryReward);
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
     * @dev Gets the amount of Ether temporary buffered on the StakingRouter contract balance
     */
    function _getStakingRouterBufferedEther() internal view returns (uint256) {
        return STAKING_ROUTER_BUFFERED_ETHER_POSITION.getStorageUint256();
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
        return
            getTotalBufferedEther().add(BEACON_BALANCE_POSITION.getStorageUint256()).add(_getTransientBalance());
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

    function _transferToStakingRouter(uint256 _maxDepositsCount) internal {
        address stakingRouter = getStakingRouter();
        require(stakingRouter != address(0), "STAKING_ROUTER_ADDRESS_ZERO");

        uint256 buffered = _getBufferedEther();
        if (buffered >= DEPOSIT_SIZE) {
            uint256 unaccounted = _getUnaccountedEther();
            uint256 numDeposits = buffered.div(DEPOSIT_SIZE);
            numDeposits = numDeposits < _maxDepositsCount ? numDeposits : _maxDepositsCount;

            uint256 amount = numDeposits * DEPOSIT_SIZE;

            address(stakingRouter).transfer(amount);

            BUFFERED_ETHER_POSITION.setStorageUint256(BUFFERED_ETHER_POSITION.getStorageUint256().sub(amount));

            STAKING_ROUTER_BUFFERED_ETHER_POSITION.setStorageUint256(
                STAKING_ROUTER_BUFFERED_ETHER_POSITION.getStorageUint256().add(amount)
            );

            emit Unbuffered(amount);

            assert(_getUnaccountedEther() == unaccounted);
        }
    }

    /**
     * @dev Invokes a deposit call to the Staking Router contract and updates buffered counters
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata module calldata
     */
    function deposit(uint256 _maxDepositsCount, uint24 _stakingModuleId, bytes _depositCalldata) external onlyDsm whenNotStopped {
        //make buffer transfer from LIDO to StakingRouter
        _transferToStakingRouter(_maxDepositsCount);

        //make deposit
        IStakingRouter stakingRouterAddress = IStakingRouter(getStakingRouter());
        uint256 keysCount = stakingRouterAddress.deposit(_maxDepositsCount, _stakingModuleId, _depositCalldata);

        _updateBufferedCounters(keysCount);
    }

    function _updateBufferedCounters(uint256 _numKeys) internal {
        uint256 _amount = _numKeys.mul(DEPOSIT_SIZE);

        DEPOSITED_VALIDATORS_POSITION.setStorageUint256(DEPOSITED_VALIDATORS_POSITION.getStorageUint256().add(_numKeys));

        uint256 buffered = _getStakingRouterBufferedEther();
        uint256 newBuffered = _amount >= buffered ? 0 : buffered.sub(_amount);
        STAKING_ROUTER_BUFFERED_ETHER_POSITION.setStorageUint256(newBuffered);
    }
}
