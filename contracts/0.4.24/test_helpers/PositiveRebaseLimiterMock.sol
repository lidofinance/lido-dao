// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../lib/PositiveRebaseLimiter.sol";

contract PositiveRebaseLimiterMock {
    using PositiveRebaseLimiter for LimiterState.Data;

    LimiterState.Data limiter;

    event ReturnValue (
        uint256 retValue
    );

    function getLimiterValues()
        external
        view
        returns (
            uint256 totalPooledEther,
            uint256 totalShares,
            uint256 maxLimiterValue,
            uint256 prevLimiterValue
        )
    {
        totalPooledEther = limiter.totalPooledEther;
        totalShares = limiter.totalShares;
        maxLimiterValue = limiter.maxLimiterValue;
        prevLimiterValue = limiter.prevLimiterValue;
    }

    function initLimiterState(
        uint256 _maxLimiterValue,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external {
        limiter = PositiveRebaseLimiter.initLimiterState(_maxLimiterValue, _totalPooledEther, _totalShares);
    }

    function isLimitReached() external view returns (bool) {
        return limiter.isLimitReached();
    }

    function applyCLBalanceUpdate(int256 _clBalanceDiff) external {
        LimiterState.Data memory limiterMemory = limiter;
        limiterMemory.applyCLBalanceUpdate(_clBalanceDiff);
        limiter = limiterMemory;
    }

    function appendEther(uint256 _etherAmount) external {
        LimiterState.Data memory limiterMemory = limiter;
        uint256 appendableEther = limiterMemory.appendEther(_etherAmount);
        limiter = limiterMemory;

        emit ReturnValue(appendableEther);
    }

    function deductShares(uint256 _sharesAmount) external {
        LimiterState.Data memory limiterMemory = limiter;
        uint256 deductableShares = limiterMemory.deductShares(_sharesAmount);
        limiter = limiterMemory;

        emit ReturnValue(deductableShares);
    }
}
