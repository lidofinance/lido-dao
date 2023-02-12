// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

// Copied from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/0457042d93d9dfd760dbaa06a4d2f1216fdbe297/contracts/utils/math/Math.sol

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity ^0.4.24;


library Packed64x4 {
    using Packed64x4 for Packed64x4.Packed;

    // string private constant ERROR_OFFSET_OUT_OF_RANGE = "OFFSET_OUT_OF_RANGE";
    uint256 internal constant UINT64_MAX = 0xFFFFFFFFFFFFFFFF;

    struct Packed {
        uint256 v;
    }

    //extract n-th uint64 from uint256
    function get(Packed memory _self, uint8 n) internal pure returns (uint64 r) {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        r = uint64((_self.v >> (64 * n)) & UINT64_MAX);
    }

    //merge n-th uint64 to uint256
    function set(Packed memory _self, uint8 n, uint64 x) internal pure {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        _self.v = _self.v & ~(UINT64_MAX << (64 * n)) | ((uint256(x) & UINT64_MAX) << (64 * n));
    }
}
