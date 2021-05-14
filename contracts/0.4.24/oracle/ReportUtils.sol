// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * Utility functions for effectively storing reports within a single storage slot
 *
 * +00 | uint16 | count            | 0..256  | number of reports received exactly like this
 * +16 | uint32 | beaconValidators | 0..1e9  | number of Lido's validators in beacon chain
 * +48 | uint64 | beaconBalance    | 0..1e18 | total amout of their balance
 *
 * Note that the 'count' is the leftmost field here. Thus it is possible to apply addition
 * operations to it when it is encoded, provided that you watch for the overflow.
 */
library ReportUtils {
    uint256 constant internal COUNT_OUTMASK = 0xFFFFFFFFFFFFFFFFFFFFFFFF0000;

    function encode(uint64 beaconBalance, uint32 beaconValidators) internal pure returns (uint256) {
        return uint256(beaconBalance) << 48 | uint256(beaconValidators) << 16;
    }

    function decode(uint256 value) internal pure returns (uint64 beaconBalance, uint32 beaconValidators) {
        beaconBalance = uint64(value >> 48);
        beaconValidators = uint32(value >> 16);
    }

    function decodeWithCount(uint256 value)
        internal pure
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint16 count
        ) {
        beaconBalance = uint64(value >> 48);
        beaconValidators = uint32(value >> 16);
        count = uint16(value);
    }

    /// @notice Check if the given reports are different, not considering the counter of the first
    function isDifferent(uint256 value, uint256 that) internal pure returns(bool) {
        return (value & COUNT_OUTMASK) != that;
    }

    function getCount(uint256 value) internal pure returns(uint16) {
        return uint16(value);
    }
}
