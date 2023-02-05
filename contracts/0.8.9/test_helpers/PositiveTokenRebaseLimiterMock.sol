// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "../lib/PositiveTokenRebaseLimiter.sol";

contract PositiveTokenRebaseLimiterMock {
    using PositiveTokenRebaseLimiter for LimiterState.Data;

    LimiterState.Data public limiter;

    event ReturnValue (
        uint256 retValue
    );

    function getLimiterValues()
        external
        view
        returns (
            uint256 totalPooledEther,
            uint256 totalShares,
            uint256 rebaseLimit,
            uint256 accumulatedRebase
        )
    {
        totalPooledEther = limiter.totalPooledEther;
        totalShares = limiter.totalShares;
        rebaseLimit = limiter.rebaseLimit;
        accumulatedRebase = limiter.accumulatedRebase;
    }

    function initLimiterState(
        uint256 _rebaseLimit,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external {
        limiter = PositiveTokenRebaseLimiter.initLimiterState(_rebaseLimit, _totalPooledEther, _totalShares);
    }

    function isLimitReached() external view returns (bool) {
        return limiter.isLimitReached();
    }

    function raiseLimit(uint256 _etherAmount) external {
        LimiterState.Data memory limiterMemory = limiter;
        limiterMemory.raiseLimit(_etherAmount);
        limiter = limiterMemory;
    }

    function consumeLimit(uint256 _etherAmount) external {
        LimiterState.Data memory limiterMemory = limiter;
        uint256 consumedEther = limiterMemory.consumeLimit(_etherAmount);
        limiter = limiterMemory;

        emit ReturnValue(consumedEther);
    }

    function getSharesToBurnLimit() external view returns (uint256) {
        LimiterState.Data memory limiterMemory = limiter;
        return limiterMemory.getSharesToBurnLimit();
    }
}
