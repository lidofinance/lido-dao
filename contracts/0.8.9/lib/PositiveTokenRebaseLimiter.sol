// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {Math256} from "../../common/lib/Math256.sol";

/**
 * This library implements positive rebase limiter for `stETH` token.
 * One needs to initialize `LimiterState` with the desired parameters:
 * - _rebaseLimit (limiter max value, nominated in LIMITER_PRECISION_BASE)
 * - _preTotalPooledEther (see `Lido.getTotalPooledEther()`), pre-rebase value
 * - _preTotalShares (see `Lido.getTotalShares()`), pre-rebase value
 *
 * The limiter allows to account for:
 * - consensus layer balance updates (can be either positive or negative)
 * - total pooled ether changes (withdrawing funds from vaults on execution layer)
 * - total shares changes (burning due to coverage, NOR penalization, withdrawals finalization, etc.)
 */

/**
 * @dev Internal limiter representation struct (storing in memory)
 */
struct TokenRebaseLimiterData {
    uint256 preTotalPooledEther;  // pre-rebase total pooled ether
    uint256 preTotalShares;       // pre-rebase total shares
    uint256 postTotalPooledEther; // accumulated post-rebase total pooled ether
    uint256 rebaseLimit;          // positive rebase limit (target value)
}

/**
 *
 * Two-steps flow: account for total supply changes and then determine the shares allowed to be burnt.
 *
 * Conventions:
 *     R - token rebase limit (i.e, {postShareRate / preShareRate - 1} <= R);
 *   inc - total pooled ether increase;
 *   dec - total shares decrease.
 *
 * ### Step 1. Calculating the allowed total pooled ether changes (preTotalShares === postTotalShares)
 *     Used for `PositiveTokenRebaseLimiter.consumeLimit()`, `PositiveTokenRebaseLimiter.raiseLimit()`.
 *
 * R = ((preTotalPooledEther + inc) / preTotalShares) / (preTotalPooledEther / preTotalShares) - 1
 * R = ((preTotalPooledEther + inc) / preTotalShares) * (preTotalShares / preTotalPooledEther) - 1
 * R = (preTotalPooledEther + inc) / preTotalPooledEther) - 1
 * R = inc/preTotalPooledEther
 *
 * isolating inc:
 *
 * ``` inc = R * preTotalPooledEther ```
 *
 * ### Step 2. Calculating the allowed to burn shares (preTotalPooledEther != postTotalPooledEther)
 *     Used for `PositiveTokenRebaseLimiter.getSharesToBurnLimit()`.
 *
 * R = (postTotalPooledEther / (preTotalShares - dec)) / (preTotalPooledEther / preTotalShares) - 1,
 * let X = postTotalPooledEther / preTotalPooledEther
 *
 * then:
 * R = X * (preTotalShares / (preTotalShares - dec)) - 1
 * (R+1) * (preTotalShares - dec) = X * preTotalShares
 *
 * isolating dec:
 * dec * (R + 1) = (R + 1 - X) * preTotalShares =>
 *
 * ``` dec = preTotalShares * (R + 1 - postTotalPooledEther/preTotalPooledEther) / (R + 1) ```
 *
 */
library PositiveTokenRebaseLimiter {
    /// @dev Precision base for the limiter (e.g.: 1e6 - 0.1%; 1e9 - 100%)
    uint256 public constant LIMITER_PRECISION_BASE = 10**9;
    /// @dev Disabled limit
    uint256 public constant UNLIMITED_REBASE = type(uint64).max;

    /**
     * @dev Initialize the new `LimiterState` structure instance
     * @param _rebaseLimit max limiter value (saturation point), see `LIMITER_PRECISION_BASE`
     * @param _preTotalPooledEther pre-rebase total pooled ether, see `Lido.getTotalPooledEther()`
     * @param _preTotalShares pre-rebase total shares, see `Lido.getTotalShares()`
     * @return limiterState newly initialized limiter structure
     */
    function initLimiterState(
        uint256 _rebaseLimit,
        uint256 _preTotalPooledEther,
        uint256 _preTotalShares
    ) internal pure returns (TokenRebaseLimiterData memory limiterState) {
        if (_rebaseLimit == 0) revert TooLowTokenRebaseLimit();
        if (_rebaseLimit > UNLIMITED_REBASE) revert TooHighTokenRebaseLimit();

        // special case
        if (_preTotalPooledEther == 0) { _rebaseLimit = UNLIMITED_REBASE; }

        limiterState.postTotalPooledEther = limiterState.preTotalPooledEther = _preTotalPooledEther;
        limiterState.preTotalShares = _preTotalShares;
        limiterState.rebaseLimit = _rebaseLimit;
    }

    /**
     * @notice check if positive rebase limit is reached
     * @param _limiterState limit repr struct
     * @return true if limit is reached
     */
    function isLimitReached(TokenRebaseLimiterData memory _limiterState) internal pure returns (bool) {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return false;
        if (_limiterState.postTotalPooledEther < _limiterState.preTotalPooledEther) return false;

        uint256 accumulatedEther = _limiterState.postTotalPooledEther - _limiterState.preTotalPooledEther;
        uint256 accumulatedRebase;

        if (_limiterState.preTotalPooledEther > 0) {
            accumulatedRebase = accumulatedEther * LIMITER_PRECISION_BASE / _limiterState.preTotalPooledEther;
        }

        return accumulatedRebase >= _limiterState.rebaseLimit;
    }

    /**
     * @notice raise limit using the given amount of ether
     * @param _limiterState limit repr struct
     */
    function raiseLimit(TokenRebaseLimiterData memory _limiterState, uint256 _etherAmount) internal pure {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return;

        _limiterState.postTotalPooledEther -= _etherAmount;
    }

    /**
     * @dev append ether and return the consumed value not exceeding the limit
     * @param _limiterState limit repr struct
     * @param _etherAmount desired ether addition
     * @return consumedEther allowed to add ether to not exceed the limit
     */
    function consumeLimit(TokenRebaseLimiterData memory _limiterState, uint256 _etherAmount)
        internal
        pure
        returns (uint256 consumedEther)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return _etherAmount;

        uint256 prevPooledEther = _limiterState.postTotalPooledEther;
        _limiterState.postTotalPooledEther += _etherAmount;

        uint256 rebaseEtherLimit =
            (_limiterState.rebaseLimit * _limiterState.preTotalPooledEther) / LIMITER_PRECISION_BASE;

        _limiterState.postTotalPooledEther = Math256.min(
            _limiterState.postTotalPooledEther,
            _limiterState.preTotalPooledEther + rebaseEtherLimit
        );

        assert(_limiterState.postTotalPooledEther >= prevPooledEther);

        return _limiterState.postTotalPooledEther - prevPooledEther;
    }

    /**
     * @dev return shares to burn value not exceeding the limit
     * @param _limiterState limit repr struct
     * @return maxSharesToBurn allowed to deduct shares to not exceed the limit
     */
    function getSharesToBurnLimit(TokenRebaseLimiterData memory _limiterState)
        internal
        pure
        returns (uint256 maxSharesToBurn)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return _limiterState.preTotalShares;

        if (isLimitReached(_limiterState)) return 0;

        uint256 rebaseLimitPlus1 = _limiterState.rebaseLimit + LIMITER_PRECISION_BASE;
        uint256 pooledEtherRate =
            (_limiterState.postTotalPooledEther * LIMITER_PRECISION_BASE) / _limiterState.preTotalPooledEther;

        maxSharesToBurn = (_limiterState.preTotalShares * (rebaseLimitPlus1 - pooledEtherRate)) / rebaseLimitPlus1;
    }

    error TooLowTokenRebaseLimit();
    error TooHighTokenRebaseLimit();
}
