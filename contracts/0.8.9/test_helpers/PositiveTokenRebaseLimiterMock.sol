// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "../lib/PositiveTokenRebaseLimiter.sol";

contract PositiveTokenRebaseLimiterMock {
    using PositiveTokenRebaseLimiter for TokenRebaseLimiterData;

    TokenRebaseLimiterData public limiter;

    event ReturnValue (
        uint256 retValue
    );

    function getLimiterValues()
        external
        view
        returns (
            uint256 preTotalPooledEther,
            uint256 preTotalShares,
            uint256 postTotalPooledEther,
            uint256 rebaseLimit
        )
    {
        preTotalPooledEther = limiter.preTotalPooledEther;
        preTotalShares = limiter.preTotalShares;
        postTotalPooledEther = limiter.postTotalPooledEther;
        rebaseLimit = limiter.rebaseLimit;
    }

    function initLimiterState(
        uint256 _rebaseLimit,
        uint256 _preTotalPooledEther,
        uint256 _preTotalShares
    ) external {
        limiter = PositiveTokenRebaseLimiter.initLimiterState(_rebaseLimit, _preTotalPooledEther, _preTotalShares);
    }

    function isLimitReached() external view returns (bool) {
        return limiter.isLimitReached();
    }

    function raiseLimit(uint256 _etherAmount) external {
        TokenRebaseLimiterData memory limiterMemory = limiter;
        limiterMemory.raiseLimit(_etherAmount);
        limiter = limiterMemory;
    }

    function consumeLimit(uint256 _etherAmount) external {
        TokenRebaseLimiterData memory limiterMemory = limiter;
        uint256 consumedEther = limiterMemory.consumeLimit(_etherAmount);
        limiter = limiterMemory;

        emit ReturnValue(consumedEther);
    }

    function getSharesToBurnLimit() external view returns (uint256) {
        TokenRebaseLimiterData memory limiterMemory = limiter;
        return limiterMemory.getSharesToBurnLimit();
    }
}
