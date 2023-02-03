// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */

// solhint-disable-next-line
pragma solidity >=0.4.24 <0.9.0;

library SafeCast {
    string private constant ERROR_SAFE_CAST_FAILED = "ERROR_SAFE_CAST_FAILED";

    uint256 internal constant MAX_UINT8 = uint256(2**8 - 1);
    uint256 internal constant MAX_UINT16 = uint256(2**16 - 1);
    uint256 internal constant MAX_UINT64 = uint256(2**64 - 1);

    function toUint8(uint256 _value) internal pure returns (uint8) {
        require(_value <= MAX_UINT8, ERROR_SAFE_CAST_FAILED);
        return uint8(_value);
    }

    function toUint16(uint256 _value) internal pure returns (uint16) {
        require(_value <= MAX_UINT16, ERROR_SAFE_CAST_FAILED);
        return uint16(_value);
    }

    function toUint64(uint256 _value) internal pure returns (uint64) {
        require(_value <= MAX_UINT64, ERROR_SAFE_CAST_FAILED);
        return uint64(_value);
    }
}
