// SPDX-FileCopyrightText: 2026 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.25;

/**
 * @notice State of a replenishing quota, packed into one storage slot
 * @param maxLimit Maximum quota that can be accumulated
 * @param prevLimit Quota left after the last update
 * @param limitPerFrame Quota restored per frame
 * @param prevTimestamp Start of the frame of the last update
 * @param frameDurationInSec Frame duration in seconds
 */
struct WithdrawalLimitData {
    uint64 maxLimit;
    uint64 prevLimit;
    uint64 limitPerFrame;
    uint32 prevTimestamp;
    uint32 frameDurationInSec;
}

/**
 * @title WithdrawalLimit
 * @author Lido
 * @notice A replenishing quota per time frame, as in `RateLimit`, with 64-bit amounts to count balances in gwei.
 *         Unlike `RateLimit`, changing the limits keeps the quota restored so far.
 */
library WithdrawalLimit {
    struct DataStorage {
        WithdrawalLimitData data;
    }

    function load(bytes32 position) internal view returns (WithdrawalLimitData memory) {
        return _storage(position).data;
    }

    function store(WithdrawalLimitData memory data, bytes32 position) internal {
        _storage(position).data = data;
    }

    function calculateCurrentLimit(
        WithdrawalLimitData memory data,
        uint256 timestamp
    ) internal pure returns (uint256 currentLimit) {
        uint256 secondsPassed = timestamp - data.prevTimestamp;
        if (secondsPassed < data.frameDurationInSec || data.limitPerFrame == 0) {
            return data.prevLimit;
        }

        currentLimit = data.prevLimit + (secondsPassed / data.frameDurationInSec) * data.limitPerFrame;
        if (currentLimit > data.maxLimit) {
            currentLimit = data.maxLimit;
        }
    }

    function updatePrevLimit(
        WithdrawalLimitData memory data,
        uint256 newLimit,
        uint256 timestamp
    ) internal pure returns (WithdrawalLimitData memory) {
        if (newLimit > data.maxLimit) revert LimitExceeded();

        uint256 framesPassed = (timestamp - data.prevTimestamp) / data.frameDurationInSec;

        // forge-lint: disable-start(unsafe-typecast)
        data.prevLimit = uint64(newLimit);
        data.prevTimestamp += uint32(framesPassed * data.frameDurationInSec);
        // forge-lint: disable-end(unsafe-typecast)

        return data;
    }

    function setLimits(
        WithdrawalLimitData memory data,
        uint256 maxLimit,
        uint256 limitPerFrame,
        uint256 frameDurationInSec,
        uint256 timestamp
    ) internal pure returns (WithdrawalLimitData memory) {
        if (maxLimit > type(uint64).max) revert TooLargeMaxLimit();
        if (limitPerFrame > maxLimit) revert TooLargeLimitPerFrame();
        if (frameDurationInSec == 0) revert ZeroFrameDuration();
        if (frameDurationInSec > type(uint32).max) revert TooLargeFrameDuration();

        // The new frame starts now, so carry over the quota restored so far; a new limit starts full
        uint256 currentLimit = isLimitSet(data) ? calculateCurrentLimit(data, timestamp) : maxLimit;

        // forge-lint: disable-start(unsafe-typecast)
        data.maxLimit = uint64(maxLimit);
        data.prevLimit = uint64(currentLimit < maxLimit ? currentLimit : maxLimit);
        data.limitPerFrame = uint64(limitPerFrame);
        data.prevTimestamp = uint32(timestamp);
        data.frameDurationInSec = uint32(frameDurationInSec);
        // forge-lint: disable-end(unsafe-typecast)

        return data;
    }

    function isLimitSet(WithdrawalLimitData memory data) internal pure returns (bool) {
        return data.maxLimit != 0;
    }

    function _storage(bytes32 position) private pure returns (DataStorage storage $) {
        assembly {
            $.slot := position
        }
    }

    /// @notice Thrown when the new remaining quota exceeds the maximum
    error LimitExceeded();

    /// @notice Thrown when the maximum quota exceeds uint64
    error TooLargeMaxLimit();

    /// @notice Thrown when the quota restored per frame exceeds the maximum quota
    error TooLargeLimitPerFrame();

    /// @notice Thrown when the frame duration is zero
    error ZeroFrameDuration();

    /// @notice Thrown when the frame duration exceeds uint32
    error TooLargeFrameDuration();
}
