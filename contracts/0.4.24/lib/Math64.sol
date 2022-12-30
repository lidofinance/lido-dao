// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

library Math64 {
    function max(uint64 a, uint64 b) internal pure returns (uint64) {
        return a > b ? a : b;
    }

    function min(uint64 a, uint64 b) internal pure returns (uint64) {
        return a < b ? a : b;
    }
}
