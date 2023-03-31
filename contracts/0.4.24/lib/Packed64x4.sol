// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

// Copied from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/0457042d93d9dfd760dbaa06a4d2f1216fdbe297/contracts/utils/math/Math.sol

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity ^0.4.24;

import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";

library Packed64x4 {
    using SafeMath for uint256;
    using Packed64x4 for Packed64x4.Packed;

    uint256 internal constant UINT64_MAX = 0xFFFFFFFFFFFFFFFF;

    struct Packed {
        uint256 v;
    }

    //extract n-th uint64 from uint256
    function get(Packed memory _self, uint8 n) internal pure returns (uint256 r) {
        r = uint64((_self.v >> (64 * n)) & UINT64_MAX);
    }

    //merge n-th uint64 to uint256
    function set(Packed memory _self, uint8 n, uint256 x) internal pure {
        require(x <= UINT64_MAX, "OVERFLOW");
        _self.v = _self.v & ~(UINT64_MAX << (64 * n)) | ((x & UINT64_MAX) << (64 * n));
    }

    function inc(Packed memory _self, uint8 n, uint256 x) internal pure {
        set(_self, n, get(_self, n).add(x));
    }

    function dec(Packed memory _self, uint8 n, uint256 x) internal pure {
        set(_self, n, get(_self, n).sub(x));
    }
}
