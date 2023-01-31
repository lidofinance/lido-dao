// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;


/// @notice Allowance-based rate limit. Allows bursts while limiting
/// throughput within a sliding time window of a fixed size.
///
/// Works by keeping track of the allowance on usage of a resource at
/// any given time. The allowance is increased with a fixed speed with
/// the time, but only up to a configured maximum allowance. When the
/// resource is used, the allowance is decreased.
///
/// Can be configured by specifying either a time window and the maximum
/// throughput within this window, or a maximum allowance and the speed
/// of the current allowance growth.
///
/// These parameters are in the following mathematical relation, given
/// that window > 0 and allowanceGrowthSpeed <= maxAllowance:
///
///   allowanceGrowthSpeed = maxThroughput / (2 * window - 1)
///   maxAllowance = allowanceGrowthSpeed * window
///
/// or
///
///   window = maxAllowance / allowanceGrowthSpeed
///   maxThroughput = 2 * maxAllowance - allowanceGrowthSpeed
///
/// Given the constant resource consumption, the maximum throughput within
/// a window is limited by `maxAllowance`, i.e. approx. `maxThroughput / 2`.
/// Otherwise, throughput spikes up to `maxThroughput` are allowed after
/// periods of low usage.
///
/// An example graph for window size 4 and max throughput 21, which is
/// equivalent to max allowance 12, allowance growth speed 3:
///
/// time ----------------------------------------------------------------->
/// allowance   12 12 12  3  3  3  3  3  3  6  3  6  3  6  9 12  3  3  3  3
/// usage        1  0 12  3  3  3  3  3  0  6  0  6  0  0  0 12  3  3  3  3
/// throughput   1  1 13 16 18 21 12 12  9 12  9 12 12  6  6 12 15 18 21 12
///
library AllowanceBasedRateLimit {
    type State is uint256;

    error TimeTooLarge();
    error RateLimitExceeded(uint256 allowance, uint256 attemptedUsage);
    error MaxAllowanceTooLarge();
    error WindowSizeCannotBeZero();
    error WindowSizeTooLarge();
    error AllowanceGrowthSpeedTooLarge();
    error AllowanceGrowthSpeedTooSmall();

    /// Layout of the tightly packed data slot (maxAllowance and windowSize
    /// are config values, allowance and time are being regularly updated):
    ///
    /// MSB <-------------------------------------------------------------- LSB
    /// 256_______________160_______________131_____________35________________0
    /// |_________________|_________________|_______________|_________________|
    /// |   maxAllowance  |    windowSize   |   allowance   |      time       |
    /// |<--- 96 bits --->|<--- 29 bits --->|<-- 96 bits -->|<--- 35 bits --->|
    ///
    uint256 private constant TIME_SIZE = 35;
    uint256 private constant ALLOWANCE_SIZE = 96;
    uint256 private constant WINDOW_SIZE_SIZE = 29;

    uint256 private constant TIME_OFFSET = 0;
    uint256 private constant ALLOWANCE_OFFSET = TIME_OFFSET + TIME_SIZE;
    uint256 private constant WINDOW_SIZE_OFFSET = ALLOWANCE_OFFSET + ALLOWANCE_SIZE;
    uint256 private constant MAX_ALLOWANCE_OFFSET = WINDOW_SIZE_OFFSET + WINDOW_SIZE_SIZE;

    uint256 private constant TIME_MAX = (1 << TIME_SIZE) - 1; // Oct 26 3058
    uint256 private constant ALLOWANCE_MAX = (1 << ALLOWANCE_SIZE) - 1; // 7.9 * 10**28
    uint256 private constant WINDOW_SIZE_MAX = (1 << WINDOW_SIZE_SIZE) - 1; // 17 years

    uint256 private constant CONFIG_MASK = ~uint256((1 << (TIME_SIZE + ALLOWANCE_SIZE)) - 1);

    ///
    /// Public interface
    ///

    function load(bytes32 slotPos) internal view returns (State state) {
        assembly { state := sload(slotPos) }
    }

    function store(State state, bytes32 slotPos) internal {
        assembly { sstore(slotPos, state) }
    }

    function initialize() internal pure returns (State) {
        return State.wrap(0);
    }

    function configureThroughput(
        State prevState,
        uint256 time,
        uint256 windowSize,
        uint256 maxThroughput
    )
        internal pure returns (State)
    {
        if (windowSize == 0) revert WindowSizeCannotBeZero();
        if (windowSize > WINDOW_SIZE_MAX) revert WindowSizeTooLarge();
        uint256 allowanceGrowthSpeed = (maxThroughput * 10**18 / (2 * windowSize - 1)) / 10**18;
        uint256 maxAllowance = allowanceGrowthSpeed * windowSize;
        return _configure(prevState, time, maxAllowance, windowSize);
    }

    function configureAllowance(
        State prevState,
        uint256 time,
        uint256 allowanceGrowthSpeed,
        uint256 maxAllowance
    )
        internal pure returns (State)
    {
        if (allowanceGrowthSpeed > maxAllowance) {
            revert AllowanceGrowthSpeedTooLarge();
        }
        if (maxAllowance == 0) {
            return _configure(prevState, time, 0, 1);
        }
        if (allowanceGrowthSpeed == 0) {
            revert AllowanceGrowthSpeedTooSmall();
        }
        uint256 windowSize = (maxAllowance * 10**18 / allowanceGrowthSpeed) / 10**18;
        if (windowSize > WINDOW_SIZE_MAX) {
            revert AllowanceGrowthSpeedTooSmall();
        }
        return _configure(prevState, time, maxAllowance, windowSize);
    }

    function getThroughputConfig(State state) internal pure returns (
        uint256 maxThroughput,
        uint256 windowSize
    ) {
        windowSize = _decodeWindowSize(state);
        uint256 maxAllowance = _decodeMaxAllowance(state);
        uint256 allowanceGrowthSpeed = (maxAllowance * 10**18 / windowSize) / 10**18;
        maxThroughput = 2 * maxAllowance - allowanceGrowthSpeed;
    }

    function getAllowanceConfig(State state) internal pure returns (
        uint256 maxAllowance,
        uint256 allowanceGrowthSpeed
    ) {
        maxAllowance = _decodeMaxAllowance(state);
        uint256 windowSize = _decodeWindowSize(state);
        allowanceGrowthSpeed = (maxAllowance * 10**18 / windowSize) / 10**18;
    }

    function calculateLimitAt(State state, uint256 time) internal pure returns (uint256) {
        if (time > TIME_MAX) revert TimeTooLarge();

        uint256 maxAllowance = _decodeMaxAllowance(state);
        if (maxAllowance == 0) return 0;

        uint256 allowanceGrowthSpeed = maxAllowance / _decodeWindowSize(state);
        uint256 timeElapsed = time - _decodeTime(state);
        uint256 allowance = _decodeAllowance(state) + timeElapsed * allowanceGrowthSpeed;

        return allowance < maxAllowance ? allowance : maxAllowance;
    }

    function recordUsageAt(State prevState, uint256 time, uint256 usage)
        internal pure returns (State)
    {
        uint256 allowance = calculateLimitAt(prevState, time);
        if (usage > allowance) {
            revert RateLimitExceeded(allowance, usage);
        }
        unchecked {
            return _updateAllowanceAndTime(prevState, allowance - usage, time);
        }
    }

    ///
    /// Helpers
    ///

    function _configure(State prevState, uint256 time, uint256 maxAllowance, uint256 windowSize)
        private pure returns (State)
    {
        if (maxAllowance > ALLOWANCE_MAX) revert MaxAllowanceTooLarge();

        uint256 prevMaxAllowance = _decodeMaxAllowance(prevState);
        uint256 allowance = calculateLimitAt(prevState, time);

        if (prevMaxAllowance == 0 || maxAllowance < allowance) {
            allowance = maxAllowance;
        }

        return _encode(time, allowance, windowSize, maxAllowance);
    }

    function _encode(uint256 time, uint256 allowance, uint256 windowSize, uint256 maxAllowance)
        private pure returns (State)
    {
        return State.wrap(time << TIME_OFFSET
            | allowance << ALLOWANCE_OFFSET
            | windowSize << WINDOW_SIZE_OFFSET
            | maxAllowance << MAX_ALLOWANCE_OFFSET);
    }

    function _updateAllowanceAndTime(State prevState, uint256 allowance, uint256 time)
        private pure returns (State)
    {
        return State.wrap(State.unwrap(prevState) & CONFIG_MASK
            | time << TIME_OFFSET
            | allowance << ALLOWANCE_OFFSET);
    }

    function _decodeTime(State state) private pure returns (uint256) {
        return (State.unwrap(state) >> TIME_OFFSET) & TIME_MAX;
    }

    function _decodeAllowance(State state) private pure returns (uint256) {
        return (State.unwrap(state) >> ALLOWANCE_OFFSET) & ALLOWANCE_MAX;
    }

    function _decodeWindowSize(State state) private pure returns (uint256) {
        return (State.unwrap(state) >> WINDOW_SIZE_OFFSET) & WINDOW_SIZE_MAX;
    }

    function _decodeMaxAllowance(State state) private pure returns (uint256) {
        return (State.unwrap(state) >> MAX_ALLOWANCE_OFFSET) & ALLOWANCE_MAX;
    }
}
