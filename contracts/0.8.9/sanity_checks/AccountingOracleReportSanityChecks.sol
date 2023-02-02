// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "../utils/access/AccessControlEnumerable.sol";
import {PositiveTokenRebaseLimiter, LimiterState} from "../lib/PositiveTokenRebaseLimiter.sol";

interface IWithdrawalQueue {
    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256 amountOfStETH,
            uint256 amountOfShares,
            address recipient,
            uint256 blockNumber,
            bool isFinalized,
            bool isClaimed
        );
}

interface ILido {
    function getSharesByPooledEth(uint256 _sharesAmount) external view returns (uint256);
}

contract AccountingOracleReportSanityChecks is AccessControlEnumerable {
    using PositiveTokenRebaseLimiter for LimiterState.Data;

    bytes32 public constant LIMITS_MANAGER_ROLE = keccak256("LIMITS_MANAGER_ROLE");

    uint256 private constant MAX_BASIS_POINTS = 10000;
    uint256 private constant SLOT_DURATION = 12;
    uint256 private constant EPOCH_DURATION = 32 * SLOT_DURATION;

    ILido private immutable LIDO;
    address private immutable WITHDRAWAL_VAULT;
    IWithdrawalQueue private immutable WITHDRAWAL_QUEUE;

    AccountingOracleReportLimits private _limits;

    struct AccountingOracleReportLimits {
        uint8 churnValidatorsByEpochLimit;
        uint16 oneOffCLBalanceDecreaseLimit;
        uint16 annualBalanceIncreaseLimit;
        uint64 requestCreationBlockMargin;
        uint64 finalizationPauseStartBlock;
        /// @dev positive token rebase allowed per single LidoOracle report
        /// uses 1e9 precision, e.g.: 1e6 - 0.1%; 1e9 - 100%, see `setMaxPositiveTokenRebase()`
        uint64 maxPositiveTokenRebase;
    }

    constructor(
        address _lido,
        address _withdrawalVault,
        address _withdrawalQueue,
        address _admin,
        address _manager
    ) {
        LIDO = ILido(_lido);
        WITHDRAWAL_VAULT = _withdrawalVault;
        WITHDRAWAL_QUEUE = IWithdrawalQueue(_withdrawalQueue);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(LIMITS_MANAGER_ROLE, _manager);
    }

    function getWithdrawalVault() public view returns (address) {
        return WITHDRAWAL_VAULT;
    }

    function getAccountingOracleLimits()
        public
        view
        returns (
            uint256 churnValidatorsByEpochLimit,
            uint256 oneOffCLBalanceDecreaseLimit,
            uint256 annualBalanceIncreaseLimit,
            uint256 requestCreationBlockMargin,
            uint256 finalizationPauseStartBlock
        )
    {
        AccountingOracleReportLimits memory limits = _limits;
        churnValidatorsByEpochLimit = limits.churnValidatorsByEpochLimit;
        oneOffCLBalanceDecreaseLimit = limits.oneOffCLBalanceDecreaseLimit;
        annualBalanceIncreaseLimit = limits.annualBalanceIncreaseLimit;
        requestCreationBlockMargin = limits.requestCreationBlockMargin;
        finalizationPauseStartBlock = limits.finalizationPauseStartBlock;
    }

    /**
     * @dev Get max positive rebase allowed per single oracle report
     * token rebase happens on total supply adjustment,
     * huge positive rebase can incur oracle report sandwitching.
     *
     * stETH balance for the `account` defined as:
     * balanceOf(account) = shares[account] * totalPooledEther / totalShares = shares[account] * shareRate
     *
     * Suppose shareRate changes when oracle reports (see `handleOracleReport`)
     * which means that token rebase happens:
     *
     * preShareRate = preTotalPooledEther() / preTotalShares()
     * postShareRate = postTotalPooledEther() / postTotalShares()
     * R = (postShareRate - preShareRate) / preShareRate
     *
     * R > 0 corresponds to the relative positive rebase value (i.e., instant APR)
     *
     * NB: The value is not set by default (explicit initialization required),
     * the recommended sane values are from 0.05% to 0.1%.
     *
     * @return maxPositiveTokenRebase max positive token rebase value with 1e9 precision:
     *   e.g.: 1e6 - 0.1%; 1e9 - 100%
     * - zero value means unititialized
     * - type(uint64).max means unlimited
     */
    function getMaxPositiveTokenRebase() public view returns (uint256 maxPositiveTokenRebase) {
        return _limits.maxPositiveTokenRebase;
    }

    /**
     * @dev Set max positive token rebase allowed per single oracle report
     * token rebase happens on total supply adjustment,
     * huge positive rebase can incur oracle report sandwitching.
     *
     * @param _maxTokenPositiveRebase max positive token rebase value with 1e9 precision:
     *   e.g.: 1e6 - 0.1%; 1e9 - 100%
     * - passing zero value is prohibited
     * - to allow unlimited rebases, pass max uint64, i.e.: type(uint64).max
     */
    function setMaxPositiveTokenRebase(uint256 _maxTokenPositiveRebase) external onlyRole(LIMITS_MANAGER_ROLE) {
        AccountingOracleReportLimits memory limits = _limits;
        _setMaxPositiveTokenRebase(limits, _maxTokenPositiveRebase);
        _limits = limits;
    }

    function setAccountingOracleLimits(
        uint256 _churnValidatorsByEpochLimit,
        uint256 _oneOffCLBalanceDecreaseLimit,
        uint256 _annualBalanceIncreaseLimit,
        uint256 _requestCreationBlockMargin,
        uint256 _finalizationPauseStartBlock
    ) external onlyRole(LIMITS_MANAGER_ROLE) {
        AccountingOracleReportLimits memory limits = _limits;
        _setChurnValidatorsByEpochLimit(limits, _churnValidatorsByEpochLimit);
        _setOneOffCLBalanceDecreaseLimit(limits, _oneOffCLBalanceDecreaseLimit);
        _setAnnualBalanceIncreaseLimit(limits, _annualBalanceIncreaseLimit);
        _setRequestCreationBlockMargin(limits, _requestCreationBlockMargin);
        _setFinalizationPauseStartBlock(limits, _finalizationPauseStartBlock);
        _limits = limits;
    }

    function setChurnValidatorsByEpochLimit(uint256 _churnValidatorsByEpochLimit)
        external
        onlyRole(LIMITS_MANAGER_ROLE)
    {
        AccountingOracleReportLimits memory limits = _limits;
        _setChurnValidatorsByEpochLimit(limits, _churnValidatorsByEpochLimit);
        _limits = limits;
    }

    function setOneOffCLBalanceDecreaseLimit(uint256 _oneOffCLBalanceDecreaseLimit)
        external
        onlyRole(LIMITS_MANAGER_ROLE)
    {
        AccountingOracleReportLimits memory limits = _limits;
        _setOneOffCLBalanceDecreaseLimit(limits, _oneOffCLBalanceDecreaseLimit);
        _limits = limits;
    }

    function setAnnualBalanceIncreaseLimit(uint256 _annualBalanceIncreaseLimit) external onlyRole(LIMITS_MANAGER_ROLE) {
        AccountingOracleReportLimits memory limits = _limits;
        _setAnnualBalanceIncreaseLimit(limits, _annualBalanceIncreaseLimit);
        _limits = limits;
    }

    function setRequestCreationBlockMargin(uint256 _requestCreationBlockMargin) external onlyRole(LIMITS_MANAGER_ROLE) {
        AccountingOracleReportLimits memory limits = _limits;
        _setRequestCreationBlockMargin(limits, _requestCreationBlockMargin);
        _limits = limits;
    }

    function setFinalizationPauseStartBlock(uint256 _finalizationPauseStartBlock)
        external
        onlyRole(LIMITS_MANAGER_ROLE)
    {
        AccountingOracleReportLimits memory limits = _limits;
        _setFinalizationPauseStartBlock(limits, _finalizationPauseStartBlock);
        _limits = limits;
    }

    function validateAccountingOracleReport(
        uint256 _timeElapsed,
        uint256 _preCLBalance,
        uint256 _postCLBalance,
        uint256 _withdrawalVaultBalance,
        uint256 _appearedValidators,
        uint256 _exitedValidators,
        uint256 _requestIdToFinalizeUpTo,
        uint256 _reportBlockNumber,
        uint256 _finalizationShareRate
    ) external view {
        // 1. Withdrawals vault one-off reported balance
        if (_withdrawalVaultBalance > getWithdrawalVault().balance) {
            revert IncorrectWithdrawalsVaultBalance(_withdrawalVaultBalance);
        }
        AccountingOracleReportLimits memory limits = _limits;

        // 2. Consensus Layer one-off balances decrease
        uint256 unifiedPostCLBalance = _postCLBalance + _withdrawalVaultBalance;
        if (_preCLBalance > unifiedPostCLBalance) {
            uint256 oneOffCLBalanceDecrease = (MAX_BASIS_POINTS * (_preCLBalance - unifiedPostCLBalance)) /
                _preCLBalance;
            if (oneOffCLBalanceDecrease > limits.oneOffCLBalanceDecreaseLimit) {
                revert IncorrectCLBalanceDecrease(oneOffCLBalanceDecrease);
            }
        }

        // 3. Consensus Layer annual balances increase
        if (_postCLBalance > _preCLBalance) {
            uint256 balanceIncrease = _postCLBalance - _preCLBalance;

            uint256 annualBalanceDiff = ((365 days * MAX_BASIS_POINTS) * balanceIncrease) /
                _preCLBalance /
                _timeElapsed;
            if (annualBalanceDiff > limits.annualBalanceIncreaseLimit) {
                revert IncorrectCLBalanceIncrease(annualBalanceDiff);
            }
        }

        // 4. Activation & exit churn limit
        uint256 churnLimit = (limits.churnValidatorsByEpochLimit * _timeElapsed) / EPOCH_DURATION;
        if (_appearedValidators > churnLimit) {
            revert IncorrectAppearedValidators();
        }
        if (_exitedValidators > churnLimit) {
            revert IncorrectExitedValidators();
        }

        // 5. No finalized id up to newer than the allowed report margin
        (, , , uint256 lastRequestCreationBlock, , ) = WITHDRAWAL_QUEUE.getWithdrawalRequestStatus(
            _requestIdToFinalizeUpTo
        );
        if (_reportBlockNumber < lastRequestCreationBlock + limits.requestCreationBlockMargin) {
            revert IncorrectRequestFinalization();
        }
        if (limits.finalizationPauseStartBlock < lastRequestCreationBlock) {
            revert IncorrectRequestFinalization();
        }

        // 6. shareRate calculated off-chain is consistent with the on-chain one
        if (_finalizationShareRate != LIDO.getSharesByPooledEth(1 ether)) {
            revert IncorrectShareRate();
        }
    }

    function smoothenTokenRebase(
        uint256 _preTotalPooledEther,
        uint256 _preTotalShares,
        int256 _clBalanceDiff,
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance
    ) external view returns (uint256 withdrawals, uint256 elRewards) {
        LimiterState.Data memory tokenRebaseLimiter = PositiveTokenRebaseLimiter.initLimiterState(
            getMaxPositiveTokenRebase(),
            _preTotalPooledEther,
            _preTotalShares
        );

        tokenRebaseLimiter.applyCLBalanceUpdate(_clBalanceDiff);

        withdrawals = tokenRebaseLimiter.appendEther(_withdrawalVaultBalance);
        elRewards = tokenRebaseLimiter.appendEther(_elRewardsVaultBalance);
    }

    function _setChurnValidatorsByEpochLimit(
        AccountingOracleReportLimits memory limits,
        uint256 _churnValidatorsByEpochLimit
    ) internal {
        if (limits.churnValidatorsByEpochLimit == _churnValidatorsByEpochLimit) return;
        _validateLessThan(_churnValidatorsByEpochLimit, type(uint8).max, "_churnValidatorsByEpochLimit");
        limits.churnValidatorsByEpochLimit = uint8(_churnValidatorsByEpochLimit);
        emit ChurnValidatorsByEpochLimitSet(_churnValidatorsByEpochLimit);
    }

    function _setOneOffCLBalanceDecreaseLimit(
        AccountingOracleReportLimits memory limits,
        uint256 _oneOffCLBalanceDecreaseLimit
    ) internal {
        if (limits.oneOffCLBalanceDecreaseLimit == _oneOffCLBalanceDecreaseLimit) return;
        _validateLessThan(_oneOffCLBalanceDecreaseLimit, type(uint16).max, "_oneOffCLBalanceDecreaseLimit");
        limits.oneOffCLBalanceDecreaseLimit = uint16(_oneOffCLBalanceDecreaseLimit);
        emit OneOffCLBalanceDecreaseSet(_oneOffCLBalanceDecreaseLimit);
    }

    function _setAnnualBalanceIncreaseLimit(
        AccountingOracleReportLimits memory limits,
        uint256 _annualBalanceIncreaseLimit
    ) internal {
        if (limits.annualBalanceIncreaseLimit == _annualBalanceIncreaseLimit) return;
        _validateLessThan(_annualBalanceIncreaseLimit, type(uint16).max, "_annualBalanceIncreaseLimit");
        limits.annualBalanceIncreaseLimit = uint16(_annualBalanceIncreaseLimit);
        emit AnnualBalanceIncreaseLimitSet(_annualBalanceIncreaseLimit);
    }

    function _setRequestCreationBlockMargin(
        AccountingOracleReportLimits memory limits,
        uint256 _requestCreationBlockMargin
    ) internal {
        if (limits.requestCreationBlockMargin == _requestCreationBlockMargin) return;
        _validateLessThan(_requestCreationBlockMargin, type(uint64).max, "_requestCreationBlockMargin");
        limits.requestCreationBlockMargin = uint64(_requestCreationBlockMargin);
        emit RequestCreationBlockMarginSet(_requestCreationBlockMargin);
    }

    function _setFinalizationPauseStartBlock(
        AccountingOracleReportLimits memory limits,
        uint256 _finalizationPauseStartBlock
    ) internal {
        if (limits.finalizationPauseStartBlock == _finalizationPauseStartBlock) return;
        _validateLessThan(_finalizationPauseStartBlock, type(uint64).max, "_finalizationPauseStartBlock");
        limits.finalizationPauseStartBlock = uint64(_finalizationPauseStartBlock);
        emit FinalizationPauseStartBlockSet(_finalizationPauseStartBlock);
    }

    function _setMaxPositiveTokenRebase(AccountingOracleReportLimits memory limits, uint256 _maxPositiveTokenRebase)
        internal
    {
        if (limits.maxPositiveTokenRebase == _maxPositiveTokenRebase) return;
        _validateLessThan(_maxPositiveTokenRebase, type(uint64).max, "_maxPositiveTokenRebase");
        limits.maxPositiveTokenRebase = uint64(_maxPositiveTokenRebase);
        emit MaxPositiveTokenRebaseSet(_maxPositiveTokenRebase);
    }

    function _validateLessThan(
        uint256 value,
        uint256 maxValue,
        string memory name
    ) internal pure {
        if (value > maxValue) revert ErrorValueTooHigh(name, maxValue, value);
    }

    struct StorageLimits {
        AccountingOracleReportLimits value;
    }

    event OneOffCLBalanceDecreaseSet(uint256 oneOffCLBalanceDecreaseLimit);
    event ChurnValidatorsByEpochLimitSet(uint256 churnValidatorsByEpochLimit);
    event AnnualBalanceIncreaseLimitSet(uint256 annualBalanceIncreaseLimit);
    event RequestCreationBlockMarginSet(uint256 requestCreationBlockMargin);
    event FinalizationPauseStartBlockSet(uint256 finalizationPauseStartBlock);
    event MaxPositiveTokenRebaseSet(uint256 maxPositiveTokenRebase);

    error IncorrectWithdrawalsVaultBalance(uint256 withdrawalVaultBalance);
    error IncorrectCLBalanceDecrease(uint256 clBalanceDecrease);
    error IncorrectCLBalanceIncrease(uint256 annualBalanceDiff);
    error IncorrectAppearedValidators();
    error IncorrectExitedValidators();
    error IncorrectRequestFinalization();
    error IncorrectShareRate();
    error ErrorValueTooHigh(string name, uint256 maxValue, uint256 value);
}
