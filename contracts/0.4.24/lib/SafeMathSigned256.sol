// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

library SafeMathSigned256 {
    function add(int256 a, int256 b) internal pure returns (int256 c) {
        c = a + b;

        if (a > 0 && b > 0 && c < 0) {
            revert ("MATH_SIGNED_OVERFLOW");
        } else if (a < 0 && b < 0 && c > 0) {
            revert ("MATH_SIGNED_UNDERFLOW");
        }
    }

    function sub(int256 a, int256 b) internal pure returns (int256 c) {
        // a - b = a + (-b)
        c = add(a, -b);
    }
}
