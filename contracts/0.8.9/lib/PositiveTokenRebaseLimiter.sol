// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {Math256} from "../../common/lib/Math256.sol";

/**
 * This library implements positive rebase limiter for `stETH` token.
 * One needs to initialize `LimiterState` with the desired parameters:
 * - _rebaseLimit (limiter max value, nominated in LIMITER_PRECISION_POINTS)
 * - _totalPooledEther (see `Lido.getTotalPooledEther()`)
 * - _totalShares (see `Lido.getTotalShares()`)
 *
 * The limiter allows to account for:
 * - consensus layer balance updates (can be either positive or negative)
 * - total pooled ether changes (withdrawing funds from vaults on execution layer)
 * - total shares changes (coverage application)
 */

library LimiterState {
    /**
      * @dev Internal limiter representation struct (storing in memory)
      */
    struct Data {
        uint256 totalPooledEther;  // total pooled ether pre-rebase
        uint256 totalShares;       // total shares before pre-rebase
        uint256 rebaseLimit;       // positive rebase limit (target value)
        uint256 accumulatedRebase; // accumulated rebase (previous value)
    }
}

library PositiveTokenRebaseLimiter {
    /// @dev Precision base for the limiter (e.g.: 1e6 - 0.1%; 1e9 - 100%)
    uint256 private constant LIMITER_PRECISION_BASE = 10**9;
    /// @dev Disabled limit
    uint256 private constant UNLIMITED_REBASE = type(uint64).max;

    /**
      * @dev Initialize the new `LimiterState` structure instance
      * @param _rebaseLimit max limiter value (saturation point), see `LIMITER_PRECISION_POINTS`
      * @param _totalPooledEther total pooled ether, see `Lido.getTotalPooledEther()`
      * @param _totalShares total shares, see `Lido.getTotalShares()`
      * @return limiterState newly initialized limiter structure
      */
    function initLimiterState(
        uint256 _rebaseLimit,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) internal pure returns (LimiterState.Data memory limiterState) {
        require(_rebaseLimit > 0, "TOO_LOW_TOKEN_REBASE_MAX");
        require(_rebaseLimit <= UNLIMITED_REBASE, "WRONG_REBASE_LIMIT");

        limiterState.totalPooledEther = _totalPooledEther;
        limiterState.totalShares = _totalShares;
        limiterState.rebaseLimit = _rebaseLimit;
    }

    /**
     * @notice check if positive rebase limit is reached
     * @param _limiterState limit repr struct
     * @return true if limit is reached
     */
    function isLimitReached(LimiterState.Data memory _limiterState) internal pure returns (bool) {
        return _limiterState.accumulatedRebase == _limiterState.rebaseLimit;
    }

    /**
     * @notice raise limit using the given amount of ether
     * @param _limiterState limit repr struct
     */
    function raiseLimit(LimiterState.Data memory _limiterState, uint256 _etherAmount) internal pure {
        if(_limiterState.rebaseLimit == UNLIMITED_REBASE) { return; }

        _limiterState.rebaseLimit += (_etherAmount * LIMITER_PRECISION_BASE) / _limiterState.totalPooledEther;
    }

    /**
     * @dev append ether and return the consumed value not exceeding the limit
     * @param _limiterState limit repr struct
     * @param _etherAmount desired ether addition
     * @return consumedEther allowed to add ether to not exceed the limit
     */
    function consumeLimit(LimiterState.Data memory _limiterState, uint256 _etherAmount)
        internal
        pure
        returns (uint256 consumedEther)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return _etherAmount;

        uint256 remainingRebase = _limiterState.rebaseLimit - _limiterState.accumulatedRebase;
        uint256 remainingEther = (remainingRebase * _limiterState.totalPooledEther) / LIMITER_PRECISION_BASE;

        consumedEther = Math256.min(remainingEther, _etherAmount);

        if (consumedEther == remainingEther) {
            _limiterState.accumulatedRebase = _limiterState.rebaseLimit;
        } else {
            _limiterState.accumulatedRebase += (
                consumedEther * LIMITER_PRECISION_BASE
            ) / _limiterState.totalPooledEther;
        }
    }

    /**
     * @dev return shares to burn value not exceeding the limit
     * @param _limiterState limit repr struct
     * @return maxSharesToBurn allowed to deduct shares to not exceed the limit
     */
    function getSharesToBurnLimit(LimiterState.Data memory _limiterState)
        internal
        pure
        returns (uint256 maxSharesToBurn)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return type(uint256).max;

        uint256 remainingRebase = _limiterState.rebaseLimit - _limiterState.accumulatedRebase;
        maxSharesToBurn = (
            _limiterState.totalShares * remainingRebase
        ) / (LIMITER_PRECISION_BASE + remainingRebase);
    }

    function getLimiterPrecisionBase() internal pure returns (uint256) {
        return LIMITER_PRECISION_BASE;
    }
}
