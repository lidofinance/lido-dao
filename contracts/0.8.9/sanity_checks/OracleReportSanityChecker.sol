// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {SafeCast} from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import {Math256} from "../../common/lib/Math256.sol";
import {AccessControlEnumerable} from "../utils/access/AccessControlEnumerable.sol";
import {PositiveTokenRebaseLimiter, TokenRebaseLimiterData} from "../lib/PositiveTokenRebaseLimiter.sol";

interface ILido {
    function getSharesByPooledEth(uint256 _sharesAmount) external view returns (uint256);
}

interface ILidoLocator {
    function lido() external view returns (address);

    function withdrawalVault() external view returns (address);

    function withdrawalQueue() external view returns (address);
}

interface IWithdrawalQueue {
    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256 amountOfStETH,
            uint256 amountOfShares,
            address recipient,
            uint256 timestamp,
            bool isFinalized,
            bool isClaimed
        );
}

/// @notice The set of restrictions used in the sanity checks of the oracle report
/// @dev struct is loaded from the storage and stored in memory during the tx running
struct LimitsList {
    /// @notice The max possible number of validators that might appear or exit on the Consensus
    ///     Layer during one epoch
    uint256 churnValidatorsByEpochLimit;
    /// @notice The max decrease of the total validators' balances on the Consensus Layer since
    ///     the previous oracle report
    /// @dev Represented in the Basis Points (100% == 100_00)
    uint256 oneOffCLBalanceDecreaseBPLimit;
    /// @notice The max annual increase of the total validators' balances on the Consensus Layer
    ///     since the previous oracle report
    /// @dev Represented in the Basis Points (100% == 100_00)
    uint256 annualBalanceIncreaseBPLimit;
    /// @notice The max deviation of stETH.totalPooledEther() / stETH.totalShares() ratio since
    ///     the previous oracle report
    /// @dev Represented in the Basis Points (100% == 100_00)
    uint256 shareRateDeviationBPLimit;
    /// @notice The min time required to be passed from the creation of the request to be
    ///     finalized till the time of the oracle report
    uint256 requestTimestampMargin;
    /// @notice The positive token rebase allowed per single LidoOracle report
    /// @dev uses 1e9 precision, e.g.: 1e6 - 0.1%; 1e9 - 100%, see `setMaxPositiveTokenRebase()`
    uint256 maxPositiveTokenRebase;
}

/// @dev The packed version of the LimitsList struct to be effectively persisted in storage
struct LimitsListPacked {
    uint8 churnValidatorsByEpochLimit;
    uint16 oneOffCLBalanceDecreaseBPLimit;
    uint16 annualBalanceIncreaseBPLimit;
    uint16 shareRateDeviationBPLimit;
    uint64 requestTimestampMargin;
    uint64 maxPositiveTokenRebase;
}

uint256 constant MAX_BASIS_POINTS = 100_00;

/// @title Sanity checks for the Lido's oracle report
/// @notice The contracts contain view methods to perform sanity checks of the Lido's oracle report
///     and lever methods for granular tuning of the params of the checks
contract OracleReportSanityChecker is AccessControlEnumerable {
    using LimitsListPacker for LimitsList;
    using LimitsListUnpacker for LimitsListPacked;
    using PositiveTokenRebaseLimiter for TokenRebaseLimiterData;

    bytes32 public constant ALL_LIMITS_MANAGER_ROLE = keccak256("LIMITS_MANAGER_ROLE");
    bytes32 public constant CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE =
        keccak256("CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE");
    bytes32 public constant ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE =
        keccak256("CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE");
    bytes32 public constant ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE =
        keccak256("ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE");
    bytes32 public constant SHARE_RATE_DEVIATION_LIMIT_MANAGER_ROLE =
        keccak256("SHARE_RATE_DEVIATION_LIMIT_MANAGER_ROLE");
    bytes32 public constant REQUEST_TIMESTAMP_MARGIN_MANAGER_ROLE = keccak256("REQUEST_TIMESTAMP_MARGIN_MANAGER_ROLE");
    bytes32 public constant MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE =
        keccak256("MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE");

    uint256 public immutable SECONDS_PER_EPOCH;
    ILidoLocator private immutable LIDO_LOCATOR;

    LimitsListPacked private _limits;

    struct ManagersRoster {
        address[] allLimitsManagers;
        address[] churnValidatorsByEpochLimitManagers;
        address[] oneOffCLBalanceDecreaseLimitManagers;
        address[] annualBalanceIncreaseLimitManagers;
        address[] shareRateDeviationLimitManagers;
        address[] requestTimestampMarginManagers;
        address[] maxPositiveTokenRebaseManagers;
    }

    /// @param _lidoLocator address of the LidoLocator instance
    /// @param _admin address to grant DEFAULT_ADMIN_ROLE of the AccessControl contract
    /// @param _limitsList initial values to be set for the limits list
    /// @param _managersRoster list of the address to grant permissions for granular limits management
    constructor(
        address _lidoLocator,
        uint256 _secondsPerEpoch,
        address _admin,
        LimitsList memory _limitsList,
        ManagersRoster memory _managersRoster
    ) {
        LIDO_LOCATOR = ILidoLocator(_lidoLocator);
        SECONDS_PER_EPOCH = _secondsPerEpoch;

        _updateLimits(_limitsList);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ALL_LIMITS_MANAGER_ROLE, _managersRoster.allLimitsManagers);
        _grantRole(CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE, _managersRoster.churnValidatorsByEpochLimitManagers);
        _grantRole(
            ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE,
            _managersRoster.oneOffCLBalanceDecreaseLimitManagers
        );
        _grantRole(ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE, _managersRoster.annualBalanceIncreaseLimitManagers);
        _grantRole(SHARE_RATE_DEVIATION_LIMIT_MANAGER_ROLE, _managersRoster.shareRateDeviationLimitManagers);
        _grantRole(REQUEST_TIMESTAMP_MARGIN_MANAGER_ROLE, _managersRoster.requestTimestampMarginManagers);
        _grantRole(MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE, _managersRoster.maxPositiveTokenRebaseManagers);
    }

    /// @notice returns the address of the LidoLocator
    function getLidoLocator() public view returns (address) {
        return address(LIDO_LOCATOR);
    }

    /// @notice Returns the limits list for the Lido's oracle report sanity checks
    function getOracleReportLimits() public view returns (LimitsList memory) {
        return _limits.unpack();
    }

    /// @notice Returns max positive token rebase value with 1e9 precision:
    ///     e.g.: 1e6 - 0.1%; 1e9 - 100%
    ///     - zero value means unititialized
    ///     - type(uint64).max means unlimited
    ///
    /// @dev Get max positive rebase allowed per single oracle report token rebase happens on total
    ///     supply adjustment, huge positive rebase can incur oracle report sandwiching.
    ///
    ///     stETH balance for the `account` defined as:
    ///         balanceOf(account) =
    ///             shares[account] * totalPooledEther / totalShares = shares[account] * shareRate
    ///
    ///     Suppose shareRate changes when oracle reports (see `handleOracleReport`)
    ///     which means that token rebase happens:
    ///
    ///         preShareRate = preTotalPooledEther() / preTotalShares()
    ///         postShareRate = postTotalPooledEther() / postTotalShares()
    ///         R = (postShareRate - preShareRate) / preShareRate
    ///
    ///         R > 0 corresponds to the relative positive rebase value (i.e., instant APR)
    ///
    /// NB: The value is not set by default (explicit initialization required),
    ///     the recommended sane values are from 0.05% to 0.1%.
    function getMaxPositiveTokenRebase() public view returns (uint256) {
        return _limits.maxPositiveTokenRebase;
    }

    /// @notice Sets the new values for the limits list
    /// @param _limitsList new limits list
    function setOracleReportLimits(LimitsList memory _limitsList) external onlyRole(ALL_LIMITS_MANAGER_ROLE) {
        _updateLimits(_limitsList);
    }

    /// @notice Sets the new value for the churnValidatorsByEpochLimit
    /// @param _churnValidatorsByEpochLimit new churnValidatorsByEpochLimit value
    function setChurnValidatorsByEpochLimit(uint256 _churnValidatorsByEpochLimit)
        external
        onlyRole(CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.churnValidatorsByEpochLimit = _churnValidatorsByEpochLimit;
        _updateLimits(limitsList);
    }

    /// @notice Sets the new value for the oneOffCLBalanceDecreaseBPLimit
    /// @param _oneOffCLBalanceDecreaseBPLimit new oneOffCLBalanceDecreaseBPLimit value
    function setOneOffCLBalanceDecreaseBPLimit(uint256 _oneOffCLBalanceDecreaseBPLimit)
        external
        onlyRole(ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.oneOffCLBalanceDecreaseBPLimit = _oneOffCLBalanceDecreaseBPLimit;
        _updateLimits(limitsList);
    }

    /// @notice Sets the new value for the annualBalanceIncreaseBPLimit
    /// @param _annualBalanceIncreaseBPLimit new annualBalanceIncreaseBPLimit value
    function setAnnualBalanceIncreaseBPLimit(uint256 _annualBalanceIncreaseBPLimit)
        external
        onlyRole(ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.annualBalanceIncreaseBPLimit = _annualBalanceIncreaseBPLimit;
        _updateLimits(limitsList);
    }

    /// @notice Sets the new value for the shareRateDeviationBPLimit
    /// @param _shareRateDeviationBPLimit new shareRateDeviationBPLimit value
    function setShareRateDeviationBPLimit(uint256 _shareRateDeviationBPLimit)
        external
        onlyRole(SHARE_RATE_DEVIATION_LIMIT_MANAGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.shareRateDeviationBPLimit = _shareRateDeviationBPLimit;
        _updateLimits(limitsList);
    }

    /// @notice Sets the new value for the requestTimestampMargin
    /// @param _requestTimestampMargin new requestTimestampMargin value
    function setRequestTimestampMargin(uint256 _requestTimestampMargin)
        external
        onlyRole(REQUEST_TIMESTAMP_MARGIN_MANAGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.requestTimestampMargin = _requestTimestampMargin;
        _updateLimits(limitsList);
    }

    /// @notice Set max positive token rebase allowed per single oracle report token rebase happens
    ///     on total supply adjustment, huge positive rebase can incur oracle report sandwiching.
    ///
    /// @param _maxPositiveTokenRebase max positive token rebase value with 1e9 precision:
    ///     e.g.: 1e6 - 0.1%; 1e9 - 100%
    ///     - passing zero value is prohibited
    ///     - to allow unlimited rebases, pass max uint64, i.e.: type(uint64).max
    function setMaxPositiveTokenRebase(uint256 _maxPositiveTokenRebase)
        external
        onlyRole(MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE)
    {
        LimitsList memory limitsList = _limits.unpack();
        limitsList.maxPositiveTokenRebase = _maxPositiveTokenRebase;
        _updateLimits(limitsList);
    }

    /// @notice Returns the allowed ETH amount that might be taken from the withdrawal vault and EL
    ///     rewards vault during Lido's oracle report processing
    /// @param _preTotalPooledEther total amount of ETH controlled by the protocol
    /// @param _preTotalShares total amount of minted stETH shares
    /// @param _preCLBalance sum of all Lido validators' balances on the Consensus Layer before the
    ///     current oracle report
    /// @param _postCLBalance sum of all Lido validators' balances on the Consensus Layer after the
    ///     current oracle report
    /// @param _withdrawalVaultBalance withdrawal vault balance on Execution Layer for report block
    /// @param _elRewardsVaultBalance elRewards vault balance on Execution Layer for report block
    /// @param _etherToLockForWithdrawals ether to lock on withdrawals queue contract
    /// @return withdrawals ETH amount allowed to be taken from the withdrawals vault
    /// @return elRewards ETH amount allowed to be taken from the EL rewards vault
    /// @return sharesToBurnLimit amount allowed to be burnt as part of the current token rebase
    function smoothenTokenRebase(
        uint256 _preTotalPooledEther,
        uint256 _preTotalShares,
        uint256 _preCLBalance,
        uint256 _postCLBalance,
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        uint256 _etherToLockForWithdrawals
    ) external view returns (uint256 withdrawals, uint256 elRewards, uint256 sharesToBurnLimit) {
        TokenRebaseLimiterData memory tokenRebaseLimiter = PositiveTokenRebaseLimiter.initLimiterState(
            getMaxPositiveTokenRebase(),
            _preTotalPooledEther,
            _preTotalShares
        );

        if (_postCLBalance < _preCLBalance) {
            tokenRebaseLimiter.raiseLimit(_preCLBalance - _postCLBalance);
        } else {
            tokenRebaseLimiter.consumeLimit(_postCLBalance - _preCLBalance);
        }

        withdrawals = tokenRebaseLimiter.consumeLimit(_withdrawalVaultBalance);
        elRewards = tokenRebaseLimiter.consumeLimit(_elRewardsVaultBalance);
        tokenRebaseLimiter.raiseLimit(_etherToLockForWithdrawals);

        sharesToBurnLimit = tokenRebaseLimiter.getSharesToBurnLimit();
    }

    /// @notice Applies sanity checks to the accounting params of Lido's oracle report
    /// @param _timeElapsed time elapsed since the previous oracle report
    /// @param _preCLBalance sum of all Lido validators' balances on the Consensus Layer before the
    ///     current oracle report
    /// @param _postCLBalance sum of all Lido validators' balances on the Consensus Layer after the
    ///     current oracle report
    /// @param _withdrawalVaultBalance withdrawal vault balance on Execution Layer for report block
    /// @param _finalizationShareRate share rate that should be used for finalization
    function checkLidoOracleReport(
        uint256 _timeElapsed,
        uint256 _preCLBalance,
        uint256 _postCLBalance,
        uint256 _withdrawalVaultBalance,
        uint256 _finalizationShareRate
    ) external view {
        LimitsList memory limitsList = _limits.unpack();

        address withdrawalVault = LIDO_LOCATOR.withdrawalVault();
        // 1. Withdrawals vault one-off reported balance
        _checkWithdrawalVaultBalance(withdrawalVault.balance, _withdrawalVaultBalance);

        // 2. Consensus Layer one-off balance decrease
        _checkOneOffCLBalanceDecrease(limitsList, _preCLBalance, _postCLBalance + _withdrawalVaultBalance);

        // 3. Consensus Layer annual balances increase
        _checkAnnualBalancesIncrease(limitsList, _preCLBalance, _postCLBalance, _timeElapsed);

        address lido = LIDO_LOCATOR.lido();
        // 4. shareRate calculated off-chain is consistent with the on-chain one
        _checkFinalizationShareRate(limitsList, lido, _finalizationShareRate);
    }

    /// @notice Applies sanity checks to the validators params of Lido's oracle report
    /// @param _timeElapsed time elapsed since the previous oracle report
    /// @param _appearedValidators number of validators activated on the Consensus Layer since
    ///     the previous report
    /// @param _exitedValidators number of validators deactivated on the Consensus Layer since
    ///     the previous report
    function checkStakingRouterOracleReport(
        uint256 _timeElapsed,
        uint256 _appearedValidators,
        uint256 _exitedValidators
    ) external view {
        LimitsList memory limitsList = _limits.unpack();
        // 1. Activation & exit churn limit
        _checkValidatorsChurnLimit(limitsList, _appearedValidators, _exitedValidators, _timeElapsed);
    }

    /// @notice Applies sanity checks to the withdrawal requests params of Lido's oracle report
    /// @param _requestIdToFinalizeUpTo right boundary of requestId range if equals 0, no requests
    ///     should be finalized
    /// @param _refReportTimestamp timestamp when the originated oracle report was submitted
    function checkWithdrawalQueueOracleReport(uint256 _requestIdToFinalizeUpTo, uint256 _refReportTimestamp)
        external
        view
    {
        LimitsList memory limitsList = _limits.unpack();
        address withdrawalQueue = LIDO_LOCATOR.withdrawalQueue();
        // 1. No finalized id up to newer than the allowed report margin
        _checkRequestIdToFinalizeUpTo(limitsList, withdrawalQueue, _requestIdToFinalizeUpTo, _refReportTimestamp);
    }

    function _checkWithdrawalVaultBalance(
        uint256 _actualWithdrawalVaultBalance,
        uint256 _reportedWithdrawalVaultBalance
    ) internal pure {
        if (_reportedWithdrawalVaultBalance > _actualWithdrawalVaultBalance)
            revert IncorrectWithdrawalsVaultBalance(_actualWithdrawalVaultBalance);
    }

    function _checkOneOffCLBalanceDecrease(
        LimitsList memory _limitsList,
        uint256 _preCLBalance,
        uint256 _unifiedPostCLBalance
    ) internal pure {
        if (_preCLBalance <= _unifiedPostCLBalance) return;
        uint256 oneOffCLBalanceDecreaseBP = (MAX_BASIS_POINTS * (_preCLBalance - _unifiedPostCLBalance)) /
            _preCLBalance;
        if (oneOffCLBalanceDecreaseBP > _limitsList.oneOffCLBalanceDecreaseBPLimit)
            revert IncorrectCLBalanceDecrease(oneOffCLBalanceDecreaseBP);
    }

    function _checkAnnualBalancesIncrease(
        LimitsList memory _limitsList,
        uint256 _preCLBalance,
        uint256 _postCLBalance,
        uint256 _timeElapsed
    ) internal pure {
        if (_preCLBalance >= _postCLBalance) return;
        uint256 balanceIncrease = _postCLBalance - _preCLBalance;
        uint256 annualBalanceIncrease = (365 days * MAX_BASIS_POINTS * balanceIncrease) /
            _preCLBalance /
            _timeElapsed;
        if (annualBalanceIncrease > _limitsList.annualBalanceIncreaseBPLimit)
            revert IncorrectCLBalanceIncrease(annualBalanceIncrease);
    }

    function _checkValidatorsChurnLimit(
        LimitsList memory _limitsList,
        uint256 _appearedValidators,
        uint256 _exitedValidators,
        uint256 _timeElapsed
    ) internal view {
        uint256 churnLimit = (_limitsList.churnValidatorsByEpochLimit * _timeElapsed) / SECONDS_PER_EPOCH;
        if (_appearedValidators > churnLimit) revert IncorrectAppearedValidators(churnLimit);
        if (_exitedValidators > churnLimit) revert IncorrectExitedValidators(churnLimit);
    }

    function _checkRequestIdToFinalizeUpTo(
        LimitsList memory _limitsList,
        address _withdrawalQueue,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _refReportTimestamp
    ) internal view {
        (, , , uint256 requestTimestampToFinalizeUpTo, , ) = IWithdrawalQueue(_withdrawalQueue)
            .getWithdrawalRequestStatus(_requestIdToFinalizeUpTo);
        if (_refReportTimestamp < requestTimestampToFinalizeUpTo + _limitsList.requestTimestampMargin)
            revert IncorrectRequestFinalization(requestTimestampToFinalizeUpTo);
    }

    function _checkFinalizationShareRate(
        LimitsList memory _limitsList,
        address _lido,
        uint256 _finalizationShareRate
    ) internal view {
        uint256 actualShareRate = ILido(_lido).getSharesByPooledEth(1 ether);
        uint256 finalizationShareDiff = Math256.abs(
            SafeCast.toInt256(_finalizationShareRate) - SafeCast.toInt256(actualShareRate)
        );
        uint256 finalizationShareDeviation = (MAX_BASIS_POINTS * finalizationShareDiff) / actualShareRate;
        if (finalizationShareDeviation > _limitsList.shareRateDeviationBPLimit)
            revert IncorrectFinalizationShareRate(finalizationShareDeviation);
    }

    function _grantRole(bytes32 _role, address[] memory _accounts) internal {
        for (uint256 i = 0; i < _accounts.length; ++i) {
            _grantRole(_role, _accounts[i]);
        }
    }

    function _updateLimits(LimitsList memory _newLimitsList) internal {
        LimitsList memory _oldLimitsList = _limits.unpack();
        if (_oldLimitsList.churnValidatorsByEpochLimit != _newLimitsList.churnValidatorsByEpochLimit) {
            emit ChurnValidatorsByEpochLimitSet(_newLimitsList.churnValidatorsByEpochLimit);
        }
        if (_oldLimitsList.oneOffCLBalanceDecreaseBPLimit != _newLimitsList.oneOffCLBalanceDecreaseBPLimit) {
            emit OneOffCLBalanceDecreaseBPLimitSet(_newLimitsList.oneOffCLBalanceDecreaseBPLimit);
        }
        if (_oldLimitsList.annualBalanceIncreaseBPLimit != _newLimitsList.annualBalanceIncreaseBPLimit) {
            emit AnnualBalanceIncreaseBPLimitSet(_newLimitsList.annualBalanceIncreaseBPLimit);
        }
        if (_oldLimitsList.shareRateDeviationBPLimit != _newLimitsList.shareRateDeviationBPLimit) {
            emit ShareRateDeviationBPLimitSet(_newLimitsList.shareRateDeviationBPLimit);
        }
        if (_oldLimitsList.requestTimestampMargin != _newLimitsList.requestTimestampMargin) {
            emit RequestTimestampMarginSet(_newLimitsList.requestTimestampMargin);
        }
        if (_oldLimitsList.maxPositiveTokenRebase != _newLimitsList.maxPositiveTokenRebase) {
            emit MaxPositiveTokenRebaseSet(_newLimitsList.maxPositiveTokenRebase);
        }
        _limits = _newLimitsList.pack();
    }

    event ChurnValidatorsByEpochLimitSet(uint256 churnValidatorsByEpochLimit);
    event OneOffCLBalanceDecreaseBPLimitSet(uint256 oneOffCLBalanceDecreaseBPLimit);
    event AnnualBalanceIncreaseBPLimitSet(uint256 annualBalanceIncreaseBPLimit);
    event ShareRateDeviationBPLimitSet(uint256 shareRateDeviationBPLimit);
    event RequestTimestampMarginSet(uint256 requestTimestampMargin);
    event MaxPositiveTokenRebaseSet(uint256 maxPositiveTokenRebase);

    error IncorrectWithdrawalsVaultBalance(uint256 actualWithdrawalVaultBalance);
    error IncorrectCLBalanceDecrease(uint256 oneOffCLBalanceDecreaseBP);
    error IncorrectCLBalanceIncrease(uint256 annualBalanceDiff);
    error IncorrectAppearedValidators(uint256 churnLimit);
    error IncorrectExitedValidators(uint256 churnLimit);
    error IncorrectRequestFinalization(uint256 requestCreationBlock);
    error IncorrectFinalizationShareRate(uint256 finalizationShareDeviation);
}

library LimitsListPacker {
    function pack(LimitsList memory _limitsList) internal pure returns (LimitsListPacked memory res) {
        res.churnValidatorsByEpochLimit = SafeCast.toUint8(_limitsList.churnValidatorsByEpochLimit);
        res.oneOffCLBalanceDecreaseBPLimit = _toBasisPoints(_limitsList.oneOffCLBalanceDecreaseBPLimit);
        res.annualBalanceIncreaseBPLimit = _toBasisPoints(_limitsList.annualBalanceIncreaseBPLimit);
        res.shareRateDeviationBPLimit = _toBasisPoints(_limitsList.shareRateDeviationBPLimit);
        res.requestTimestampMargin = SafeCast.toUint64(_limitsList.requestTimestampMargin);
        res.maxPositiveTokenRebase = SafeCast.toUint64(_limitsList.maxPositiveTokenRebase);
    }

    function _toBasisPoints(uint256 _value) private pure returns (uint16) {
        require(_value <= MAX_BASIS_POINTS, "BASIS_POINTS_OVERFLOW");
        return uint16(_value);
    }
}

library LimitsListUnpacker {
    function unpack(LimitsListPacked memory _limitsList) internal pure returns (LimitsList memory res) {
        res.churnValidatorsByEpochLimit = _limitsList.churnValidatorsByEpochLimit;
        res.oneOffCLBalanceDecreaseBPLimit = _limitsList.oneOffCLBalanceDecreaseBPLimit;
        res.annualBalanceIncreaseBPLimit = _limitsList.annualBalanceIncreaseBPLimit;
        res.shareRateDeviationBPLimit = _limitsList.shareRateDeviationBPLimit;
        res.requestTimestampMargin = _limitsList.requestTimestampMargin;
        res.maxPositiveTokenRebase = _limitsList.maxPositiveTokenRebase;
    }
}
