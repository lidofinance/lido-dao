// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

// Copied from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/0457042d93d9dfd760dbaa06a4d2f1216fdbe297/contracts/utils/math/Math.sol

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity ^0.4.24;

import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";

library Packed64x4 {
    using SafeMath64 for uint64;
    using Packed64x4 for Packed64x4.Packed;

    // string private constant ERROR_OFFSET_OUT_OF_RANGE = "OFFSET_OUT_OF_RANGE";

    struct Packed {
        uint256 v;
    }

    //extract n-th uint64 from uint256
    function get(Packed memory _self, uint8 n) internal pure returns (uint64 r) {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        r = uint64((_self.v >> (64 * n)) & 0xFFFFFFFFFFFFFFFF);
    }

    //merge n-th uint64 to uint256
    function set(Packed memory _self, uint8 n, uint64 x) internal pure {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        _self.v = _self.v & ~(uint256(0xFFFFFFFFFFFFFFFF) << (64 * n)) | ((uint256(x) & 0xFFFFFFFFFFFFFFFF) << (64 * n));
    }

    function inc(Packed memory _self, uint8 n, uint64 x) internal pure returns (uint64 r) {
        r = _self.get(n).add(x);
        _self.set(n, r);
    }

    function dec(Packed memory _self, uint8 n, uint64 x) internal pure returns (uint64 r) {
         r = _self.get(n).sub(x);
        _self.set(n, r);
    }

    function cpy(Packed memory _self, uint8 na, uint8 nb) internal pure returns (uint64 r) {
        r = _self.get(na);
        _self.set(nb, r);
    }

    function sum(Packed memory _self, uint8 na, uint8 nb) internal pure returns (uint64 r) {
        return _self.get(na).add(_self.get(nb));
    }

    function diff(Packed memory _self, uint8 na, uint8 nb) internal pure returns (uint64 r) {
        return _self.get(na).sub(_self.get(nb));
    }
}
