// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

// Copied from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/0457042d93d9dfd760dbaa06a4d2f1216fdbe297/contracts/utils/math/Math.sol

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity ^0.4.24;

import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";

library Packed64 {
    using SafeMath64 for uint64;
    using Packed64 for uint256;

    // string private constant ERROR_OFFSET_OUT_OF_RANGE = "OFFSET_OUT_OF_RANGE";

    //extract n-th uint64 from uint256
    function get(uint256 v, uint8 n) internal pure returns (uint64) {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        return uint64((v >> (64 * n)) & 0xFFFFFFFFFFFFFFFF);
    }

    //merge n-th uint64 to uint256
    function set(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        // require(n < 4, ERROR_OFFSET_OUT_OF_RANGE);
        //number = number & ~(1 << n) | (x << n);
        return v & ~(uint256(0xFFFFFFFFFFFFFFFF) << (64 * n)) | ((uint256(x) & 0xFFFFFFFFFFFFFFFF) << (64 * n));
    }

    function inc(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        return v.set(n, v.get(n).add(x));
    }

    function dec(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        return v.set(n, v.get(n).sub(x));
    }

    function cpy(uint256 v, uint8 na, uint8 nb) internal pure returns (uint256) {
        return v.set(nb, v.get(na));
    }

    function sum(uint256 v, uint8 na, uint8 nb) internal pure returns (uint64) {
        return v.get(na).add(v.get(nb));
    }

    function diff(uint256 v, uint8 na, uint8 nb) internal pure returns (uint64) {
        return v.get(na).sub(v.get(nb));
    }
}
