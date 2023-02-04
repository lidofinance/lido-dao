// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */

// solhint-disable-next-line
pragma solidity >=0.4.24 <0.9.0;

library SafeCast {
    uint256 internal constant MAX_INT256 = uint256(2**255 - 1);

    uint256 internal constant MAX_UINT8 = uint256(2**8 - 1);
    uint256 internal constant MAX_UINT16 = uint256(2**16 - 1);
    uint256 internal constant MAX_UINT64 = uint256(2**64 - 1);

    uint256 internal constant MAX_BASIS_POINTS = 100_00;

    function toInt256(uint256 _value) internal pure returns (int256) {
        require(_value <= MAX_INT256, "INT256_OVERFLOW");
        return int256(_value);
    }

    function toUint8(uint256 _value) internal pure returns (uint8) {
        require(_value <= MAX_UINT8, "UINT8_OVERFLOW");
        return uint8(_value);
    }

    function toUint16(uint256 _value) internal pure returns (uint16) {
        require(_value <= MAX_UINT16, "UINT16_OVERFLOW");
        return uint16(_value);
    }

    function toUint64(uint256 _value) internal pure returns (uint64) {
        require(_value <= MAX_UINT64, "UINT64_OVERFLOW");
        return uint64(_value);
    }

    function toBasisPoints(uint256 _value) internal pure returns (uint16) {
        require(_value <= MAX_BASIS_POINTS, "BASIS_POINTS_OVERFLOW");
        return uint16(_value);
    }
}
