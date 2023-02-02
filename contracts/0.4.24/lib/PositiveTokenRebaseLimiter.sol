// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";

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
    using SafeMath for uint256;

    /// @dev Precision base for the limiter (e.g.: 1e6 - 0.1%; 1e9 - 100%)
    uint256 private constant LIMITER_PRECISION_BASE = 10**9;
    /// @dev Disabled limit
    uint256 private constant UNLIMITED_REBASE = uint256(-1);

    /**
      * @dev Initialize the new `LimiterState` structure instance
      * @param _rebaseLimit max limiter value (saturation point), see `LIMITER_PRECISION_POINTS`
      * @param _totalPooledEther total pooled ether, see `Lido.getTotalPooledEther()`
      * @param _totalShares total shares, see `Lido.getTotalShares()`
      * @return newly initialized limiter structure
      */
    function initLimiterState(
        uint256 _rebaseLimit,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) internal pure returns (LimiterState.Data memory _limiterState) {
        require(_rebaseLimit > 0, "TOO_LOW_TOKEN_REBASE_MAX");
        require(_rebaseLimit <= UNLIMITED_REBASE, "WRONG_REBASE_LIMIT");

        _limiterState.totalPooledEther = _totalPooledEther;
        _limiterState.totalShares = _totalShares;
        _limiterState.rebaseLimit = _rebaseLimit;
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
     * @dev apply consensus layer balance update
     * @param _limiterState limit repr struct
     * @param _clBalanceDiff cl balance diff (can be negative!)
     *
     * NB: if `_clBalanceDiff` is negative than max limiter value is pushed higher
     * otherwise limiter is updated with the `appendEther` call.
     */
    function applyCLBalanceUpdate(LimiterState.Data memory _limiterState, int256 _clBalanceDiff) internal pure {
        require(_limiterState.accumulatedRebase == 0, "DIRTY_LIMITER_STATE");

        if (_clBalanceDiff < 0 && (_limiterState.rebaseLimit != UNLIMITED_REBASE)) {
            _limiterState.rebaseLimit = _limiterState.rebaseLimit.add(
                uint256(-_clBalanceDiff).mul(LIMITER_PRECISION_BASE).div(_limiterState.totalPooledEther)
            );
        } else {
            appendEther(_limiterState, uint256(_clBalanceDiff));
        }
    }

    /**
     * @dev append ether and return value not exceeding the limit
     * @param _limiterState limit repr struct
     * @param _etherAmount desired ether addition
     * @return allowed to add ether to not exceed the limit
     */
    function appendEther(LimiterState.Data memory _limiterState, uint256 _etherAmount)
        internal
        pure
        returns (uint256 appendableEther)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return _etherAmount;

        uint256 remainingRebase = _limiterState.rebaseLimit.sub(_limiterState.accumulatedRebase);
        uint256 remainingEther = remainingRebase.mul(_limiterState.totalPooledEther).div(LIMITER_PRECISION_BASE);

        appendableEther = Math256.min(remainingEther, _etherAmount);

        if (appendableEther == remainingEther) {
            _limiterState.accumulatedRebase = _limiterState.rebaseLimit;
        } else {
            _limiterState.accumulatedRebase = _limiterState.accumulatedRebase.add(
                appendableEther.mul(LIMITER_PRECISION_BASE).div(_limiterState.totalPooledEther)
            );
        }
    }

    /**
     * @dev deduct shares and return value not exceeding the limit
     * @param _limiterState limit repr struct
     * @param _sharesAmount desired shares deduction
     * @return allowed to deduct shares to not exceed the limit
     */
    function deductShares(LimiterState.Data memory _limiterState, uint256 _sharesAmount)
        internal
        pure
        returns (uint256 deductableShares)
    {
        if (_limiterState.rebaseLimit == UNLIMITED_REBASE) return _sharesAmount;

        uint256 remainingRebase = _limiterState.rebaseLimit.sub(_limiterState.accumulatedRebase);
        uint256 remainingShares = _limiterState.totalShares.mul(remainingRebase).div(
            LIMITER_PRECISION_BASE.add(remainingRebase)
        );

        deductableShares = Math256.min(_sharesAmount, remainingShares);

        if (deductableShares == remainingShares) {
            _limiterState.accumulatedRebase = _limiterState.rebaseLimit;
        } else {
            _limiterState.accumulatedRebase = _limiterState.accumulatedRebase.add(
                deductableShares.mul(LIMITER_PRECISION_BASE).div(_limiterState.totalShares.sub(deductableShares))
            );
        }
    }

    function getLimiterPrecisionBase() internal pure returns (uint256) {
        return LIMITER_PRECISION_BASE;
    }
}
