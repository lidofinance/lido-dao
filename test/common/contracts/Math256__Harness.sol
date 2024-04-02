// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {Math256} from "contracts/common/lib/Math256.sol";

contract Math256__Harness {
    function max(uint256 a, uint256 b) public pure returns (uint256) {
        return Math256.max(a, b);
    }

    function min(uint256 a, uint256 b) public pure returns (uint256) {
        return Math256.min(a, b);
    }

    function max(int256 a, int256 b) public pure returns (int256) {
        return Math256.max(a, b);
    }

    function min(int256 a, int256 b) public pure returns (int256) {
        return Math256.min(a, b);
    }

    function ceilDiv(uint256 a, uint256 b) public pure returns (uint256) {
        return Math256.ceilDiv(a, b);
    }

    function absDiff(uint256 a, uint256 b) public pure returns (uint256) {
        return Math256.absDiff(a, b);
    }
}
