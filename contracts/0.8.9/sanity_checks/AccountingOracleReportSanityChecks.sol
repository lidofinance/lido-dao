// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {SafeCast} from "../../common/lib/SafeCast.sol";
import {AccessControlEnumerable} from "../utils/access/AccessControlEnumerable.sol";
import {PositiveTokenRebaseLimiter, LimiterState} from "../lib/PositiveTokenRebaseLimiter.sol";

interface ILido {
    function getSharesByPooledEth(uint256 _sharesAmount) external view returns (uint256);
}

interface ILidoLocator {
    function getLido() external view returns (address);

    function getWithdrawalVault() external view returns (address);

    function getWithdrawalQueue() external view returns (address);
}

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

struct LimitsList {
    uint256 churnValidatorsByEpochLimit;
    uint256 oneOffCLBalanceDecreaseLimit;
    uint256 annualBalanceIncreaseLimit;
    uint256 requestCreationBlockMargin;
    uint256 finalizationPauseStartBlock;
    uint256 maxPositiveTokenRebase;
}

struct LimitsListPacked {
    uint8 churnValidatorsByEpochLimit;
    uint16 oneOffCLBalanceDecreaseLimit;
    uint16 annualBalanceIncreaseLimit;
    uint64 requestCreationBlockMargin;
    uint64 finalizationPauseStartBlock;
    /// @dev positive token rebase allowed per single LidoOracle report
    /// uses 1e9 precision, e.g.: 1e6 - 0.1%; 1e9 - 100%, see `setMaxPositiveTokenRebase()`
    uint64 maxPositiveTokenRebase;
}

contract AccountingOracleReportSanityChecks is AccessControlEnumerable {
    using PositiveTokenRebaseLimiter for LimiterState.Data;
    using LimitsListUnpacker for LimitsListPacked;
    using LimitsListPacker for LimitsList;
    using LimitsListUtils for LimitsList;

    bytes32 public constant ALL_LIMITS_MANAGER_ROLE = keccak256("LIMITS_MANAGER_ROLE");
    bytes32 public constant CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE =
        keccak256("CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE");
    bytes32 public constant ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE =
        keccak256("CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE");
    bytes32 public constant ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE =
        keccak256("ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE");
    bytes32 public constant REQUEST_CREATION_BLOCK_MARGIN_MANAGER_ROLE =
        keccak256("REQUEST_CREATION_BLOCK_MARGIN_MANAGER_ROLE");
    bytes32 public constant FINALIZATION_PAUSE_START_BLOCK_MANAGER_ROLE =
        keccak256("FINALIZATION_PAUSE_START_BLOCK_MANAGER_ROLE");
    bytes32 public constant MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE =
        keccak256("MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE");

    uint256 private constant MAX_BASIS_POINTS = 10000;
    uint256 private constant SLOT_DURATION = 12;
    uint256 private constant EPOCH_DURATION = 32 * SLOT_DURATION;

    ILidoLocator private immutable LIDO_LOCATOR;

    LimitsListPacked private _limits;

    struct ManagersRoster {
        address[] allLimitsManagers;
        address[] churnValidatorsByEpochLimitManagers;
        address[] oneOffCLBalanceDecreaseLimitManagers;
        address[] annualBalanceIncreaseLimitManagers;
        address[] requestCreationBlockMarginManagers;
        address[] finalizationPauseStartBlockManagers;
        address[] maxPositiveTokenRebaseManagers;
    }

    constructor(
        address _lidoLocator,
        address _admin,
        LimitsList memory _limitsList,
        ManagersRoster memory _managersRoster
    ) {
        LIDO_LOCATOR = ILidoLocator(_lidoLocator);
        _setAccountingOracleLimits(_limitsList);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ALL_LIMITS_MANAGER_ROLE, _managersRoster.allLimitsManagers);
        _grantRole(CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE, _managersRoster.churnValidatorsByEpochLimitManagers);
        _grantRole(
            ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE,
            _managersRoster.oneOffCLBalanceDecreaseLimitManagers
        );
        _grantRole(ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE, _managersRoster.annualBalanceIncreaseLimitManagers);
        _grantRole(REQUEST_CREATION_BLOCK_MARGIN_MANAGER_ROLE, _managersRoster.requestCreationBlockMarginManagers);
        _grantRole(FINALIZATION_PAUSE_START_BLOCK_MANAGER_ROLE, _managersRoster.finalizationPauseStartBlockManagers);
        _grantRole(MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE, _managersRoster.maxPositiveTokenRebaseManagers);
    }

    function getLidoLocator() public view returns (address) {
        return address(LIDO_LOCATOR);
    }

    function getAccountingOracleLimits()
        public
        view
        returns (
            uint256 churnValidatorsByEpochLimit,
            uint256 oneOffCLBalanceDecreaseLimit,
            uint256 annualBalanceIncreaseLimit,
            uint256 requestCreationBlockMargin,
            uint256 finalizationPauseStartBlock,
            uint256 maxPositiveTokenRebase
        )
    {
        LimitsListPacked memory limits = _limits;
        churnValidatorsByEpochLimit = limits.churnValidatorsByEpochLimit;
        oneOffCLBalanceDecreaseLimit = limits.oneOffCLBalanceDecreaseLimit;
        annualBalanceIncreaseLimit = limits.annualBalanceIncreaseLimit;
        requestCreationBlockMargin = limits.requestCreationBlockMargin;
        finalizationPauseStartBlock = limits.finalizationPauseStartBlock;
        maxPositiveTokenRebase = limits.maxPositiveTokenRebase;
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

    function setAccountingOracleLimits(LimitsList memory _limitsList) external onlyRole(ALL_LIMITS_MANAGER_ROLE) {
        _setAccountingOracleLimits(_limitsList);
    }

    function _setAccountingOracleLimits(LimitsList memory _limitsList) internal {
        _updateLimits(_limits.unpack(), _limitsList);
    }

    function setChurnValidatorsByEpochLimit(uint256 _churnValidatorsByEpochLimit)
        external
        onlyRole(CHURN_VALIDATORS_BY_EPOCH_LIMIT_MANGER_ROLE)
    {
        _updateLimits(_limits.unpack().setChurnValidatorsByEpochLimit(_churnValidatorsByEpochLimit));
    }

    function setOneOffCLBalanceDecreaseLimit(uint256 _oneOffCLBalanceDecreaseLimit)
        external
        onlyRole(ONE_OFF_CL_BALANCE_DECREASE_LIMIT_MANAGER_ROLE)
    {
        _updateLimits(_limits.unpack().setOneOffCLBalanceDecreaseLimit(_oneOffCLBalanceDecreaseLimit));
    }

    function setAnnualBalanceIncreaseLimit(uint256 _annualBalanceIncreaseLimit)
        external
        onlyRole(ANNUAL_BALANCE_INCREASE_LIMIT_MANAGER_ROLE)
    {
        _updateLimits(_limits.unpack().setAnnualBalanceIncreaseLimit(_annualBalanceIncreaseLimit));
    }

    function setRequestCreationBlockMargin(uint256 _requestCreationBlockMargin)
        external
        onlyRole(REQUEST_CREATION_BLOCK_MARGIN_MANAGER_ROLE)
    {
        _updateLimits(_limits.unpack().setRequestCreationBlockMargin(_requestCreationBlockMargin));
    }

    function setFinalizationPauseStartBlock(uint256 _finalizationPauseStartBlock)
        external
        onlyRole(FINALIZATION_PAUSE_START_BLOCK_MANAGER_ROLE)
    {
        _updateLimits(_limits.unpack().setRequestCreationBlockMargin(_finalizationPauseStartBlock));
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
    function setMaxPositiveTokenRebase(uint256 _maxTokenPositiveRebase)
        external
        onlyRole(MAX_POSITIVE_TOKEN_REBASE_MANAGER_ROLE)
    {
        _updateLimits(_limits.unpack().setMaxPositiveTokenRebase(_maxTokenPositiveRebase));
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
        address withdrawalVault = LIDO_LOCATOR.getWithdrawalVault();
        if (_withdrawalVaultBalance > withdrawalVault.balance) {
            revert IncorrectWithdrawalsVaultBalance(_withdrawalVaultBalance);
        }
        LimitsList memory limits = _limits.unpack();

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
        address withdrawalQueue = LIDO_LOCATOR.getWithdrawalQueue();
        (, , , uint256 lastRequestCreationBlock, , ) = IWithdrawalQueue(withdrawalQueue).getWithdrawalRequestStatus(
            _requestIdToFinalizeUpTo
        );
        if (_reportBlockNumber < lastRequestCreationBlock + limits.requestCreationBlockMargin) {
            revert IncorrectRequestFinalization();
        }
        if (limits.finalizationPauseStartBlock < lastRequestCreationBlock) {
            revert IncorrectRequestFinalization();
        }

        // 6. shareRate calculated off-chain is consistent with the on-chain one
        address lido = LIDO_LOCATOR.getLido();
        if (_finalizationShareRate != ILido(lido).getSharesByPooledEth(1 ether)) {
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

    function _grantRole(bytes32 _role, address[] memory _accounts) internal {
        for (uint256 i = 0; i < _accounts.length; ++i) {
            _grantRole(_role, _accounts[i]);
        }
    }

    function _updateLimits(LimitsList memory _new) internal {
        _updateLimits(_limits.unpack(), _new);
    }

    function _updateLimits(LimitsList memory _old, LimitsList memory _new) internal {
        if (_old.churnValidatorsByEpochLimit != _new.churnValidatorsByEpochLimit) {
            emit ChurnValidatorsByEpochLimitSet(_new.churnValidatorsByEpochLimit);
        }
        if (_old.oneOffCLBalanceDecreaseLimit != _new.oneOffCLBalanceDecreaseLimit) {
            emit OneOffCLBalanceDecreaseSet(_new.oneOffCLBalanceDecreaseLimit);
        }
        if (_old.annualBalanceIncreaseLimit != _new.annualBalanceIncreaseLimit) {
            emit AnnualBalanceIncreaseLimitSet(_new.annualBalanceIncreaseLimit);
        }
        if (_old.requestCreationBlockMargin != _new.requestCreationBlockMargin) {
            emit RequestCreationBlockMarginSet(_new.requestCreationBlockMargin);
        }
        if (_old.finalizationPauseStartBlock != _new.finalizationPauseStartBlock) {
            emit FinalizationPauseStartBlockSet(_new.finalizationPauseStartBlock);
        }
        if (_old.maxPositiveTokenRebase != _new.maxPositiveTokenRebase) {
            emit MaxPositiveTokenRebaseSet(_new.maxPositiveTokenRebase);
        }
        _limits = _new.pack();
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

library LimitsListPacker {
    function pack(LimitsList memory _limitsList) internal pure returns (LimitsListPacked memory res) {
        res.churnValidatorsByEpochLimit = SafeCast.toUint8(_limitsList.churnValidatorsByEpochLimit);
        res.oneOffCLBalanceDecreaseLimit = SafeCast.toUint16(_limitsList.oneOffCLBalanceDecreaseLimit);
        res.annualBalanceIncreaseLimit = SafeCast.toUint16(_limitsList.annualBalanceIncreaseLimit);
        res.requestCreationBlockMargin = SafeCast.toUint64(_limitsList.requestCreationBlockMargin);
        res.finalizationPauseStartBlock = SafeCast.toUint64(_limitsList.finalizationPauseStartBlock);
        res.maxPositiveTokenRebase = SafeCast.toUint64(_limitsList.maxPositiveTokenRebase);
    }
}

library LimitsListUnpacker {
    function unpack(LimitsListPacked memory _limitsList) internal pure returns (LimitsList memory res) {
        res.churnValidatorsByEpochLimit = _limitsList.churnValidatorsByEpochLimit;
        res.oneOffCLBalanceDecreaseLimit = _limitsList.oneOffCLBalanceDecreaseLimit;
        res.annualBalanceIncreaseLimit = _limitsList.annualBalanceIncreaseLimit;
        res.requestCreationBlockMargin = _limitsList.requestCreationBlockMargin;
        res.finalizationPauseStartBlock = _limitsList.finalizationPauseStartBlock;
        res.maxPositiveTokenRebase = _limitsList.maxPositiveTokenRebase;
    }
}

library LimitsListUtils {
    function setChurnValidatorsByEpochLimit(LimitsList memory _limitsList, uint256 _churnValidatorsByEpochLimit)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.churnValidatorsByEpochLimit = _churnValidatorsByEpochLimit;
        return _limitsList;
    }

    function setOneOffCLBalanceDecreaseLimit(LimitsList memory _limitsList, uint256 _oneOffCLBalanceDecreaseLimit)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.oneOffCLBalanceDecreaseLimit = _oneOffCLBalanceDecreaseLimit;
        return _limitsList;
    }

    function setAnnualBalanceIncreaseLimit(LimitsList memory _limitsList, uint256 _annualBalanceIncreaseLimit)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.oneOffCLBalanceDecreaseLimit = _annualBalanceIncreaseLimit;
        return _limitsList;
    }

    function setRequestCreationBlockMargin(LimitsList memory _limitsList, uint256 _requestCreationBlockMargin)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.requestCreationBlockMargin = _requestCreationBlockMargin;
        return _limitsList;
    }

    function setFinalizationPauseStartBlock(LimitsList memory _limitsList, uint256 _finalizationPauseStartBlock)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.finalizationPauseStartBlock = _finalizationPauseStartBlock;
        return _limitsList;
    }

    function setMaxPositiveTokenRebase(LimitsList memory _limitsList, uint256 _maxPositiveTokenRebase)
        internal
        pure
        returns (LimitsList memory)
    {
        _limitsList.maxPositiveTokenRebase = _maxPositiveTokenRebase;
        return _limitsList;
    }
}
