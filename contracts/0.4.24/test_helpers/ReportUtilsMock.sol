// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../oracle/ReportUtils.sol";


contract ReportUtilsMock {
    using ReportUtils for uint256;

    function encode(uint64 beaconBalance, uint32 beaconValidators) public pure returns (uint256) {
        return ReportUtils.encode(beaconBalance, beaconValidators);
    }

    function decode(uint256 value) public pure returns (uint64 beaconBalance, uint32 beaconValidators) {
        return value.decode();
    }

    function decodeWithCount(uint256 value)
        public pure
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint16 count)
    {
        return value.decodeWithCount();
    }

    function isDifferent(uint256 value, uint256 that) public pure returns(bool) {
        return value.isDifferent(that);
    }

    function getCount(uint256 value) public pure returns(uint16) {
        return value.getCount();
    }
}
