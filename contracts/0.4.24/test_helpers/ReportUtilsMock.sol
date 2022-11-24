// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../oracle/ReportUtils.sol";


contract ReportUtilsMock {
    using ReportUtils for uint256;

    function encode(
        uint64 beaconBalance,
        uint32 beaconValidators,
        uint256 totalExitedValidators,
        uint256 wcBufferedEther,
        uint256[] requestIdToFinalizeUpTo,
        uint256[] finalizationPooledEtherAmount,
        uint256[] finalizationSharesAmount
    ) internal pure returns (uint256) {
        // TODO: maybe stop accepting less than 256bit variables due to https://docs.soliditylang.org/en/latest/security-considerations.html#minor-details
        return 0;
    }

    function decode(uint256 value)
        internal pure
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint256 totalExitedValidators,
            uint256 wcBufferedEther,
            uint256[] requestIdToFinalizeUpTo,
            uint256[] finalizationPooledEtherAmount,
            uint256[] finalizationSharesAmount
    ) {
        return value.decode();
    }

    function decodeWithCount(uint256 value)
        internal pure
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint16 count,
            uint32 exitedValidators,
            uint40 wcBufferedEther,
            uint72 newFinalizedLength
    ) {
        return value.decodeWithCount();
    }

    function isDifferent(uint256 value, uint256 that) public pure returns(bool) {
        return value.isDifferent(that);
    }

    function getCount(uint256 value) public pure returns(uint16) {
        return value.getCount();
    }
}
