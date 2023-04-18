// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import { Math256 } from "contracts/common/lib/Math256.sol";

contract Math256Test is Test {

    /// int256 tests for max/min

    function testMaxUint256Simple1() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    function testMaxUint256Simple2() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxUint256Simple3() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxUint256Fuzz(uint256 a, uint256 b) public {
        uint256 expected;
        
        if (a > b) {
            expected = a;
        } else if (a == b) {
            expected = a;
        } else {
            expected = b;
        }

        assertEq(Math256.max(b, a), expected);
    }

    function testMinUint256Simple1() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    function testMinUint256Simple2() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    function testMinUint256Simple3() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testUint256MinFuzz(uint256 a, uint256 b) public {
        uint256 expected;
        
        if (a < b) {
            expected = a;
        } else if (a == b) {
            expected = a;
        } else {
            expected = b;
        }

        assertEq(Math256.min(b, a), expected);
    }

    /// int256 tests for max/min

    function testMaxInt256Simple1() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    function testMaxInt256Simple2() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxInt256Simple3() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxInt256Fuzz(int256 a, int256 b) public {
        int256 expected;
        
        if (a > b) {
            expected = a;
        } else if (a == b) {
            expected = a;
        } else {
            expected = b;
        }

        assertEq(Math256.max(b, a), expected);
    }

    function testMinInt256Simple1() public {
        int256 a = 2;
        int256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    function testMinInt256Simple2() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    function testMinInt256Simple3() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testInt256MinFuzz(int256 a, int256 b) public {
        int256 expected;
        
        if (a < b) {
            expected = a;
        } else if (a == b) {
            expected = a;
        } else {
            expected = b;
        }

        assertEq(Math256.min(b, a), expected);
    }

    /// tests for ceilDiv

    function testCeilDivByZero() public {
        uint256 a = 1;
        uint256 b = 0;

        vm.expectRevert("Division or modulo by 0");
        Math256.ceilDiv(a, b);
    }

    function testCeilDivZeroFromFour() public {
        uint256 a = 0;
        uint256 b = 4;
        assertEq(Math256.ceilDiv(a, b), 0);
    }

    function testCeilDivByOne() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math256.ceilDiv(a, b), a);
    }

    function testCeilDivByTwo() public {
        uint256 a = 4;
        uint256 b = 2;

        assertEq(Math256.ceilDiv(a, b), b);
    }

    function testCeilDivByThree() public {
        uint256 a = 4;
        uint256 b = 3;

        assertEq(Math256.ceilDiv(a, b), 2);
    }

    function testCeilDivFuzz(uint256 a, uint256 b) public {
        // This case should always error
        if (b == 0) {
            vm.expectRevert("Division or modulo by 0");
        }

        // This case should always be zero
        if (a == 0) {
            assertEq(Math256.ceilDiv(a, b), 0);
        }

        // When they are both equal, the orientation shouldn't matter, it should be 1
        if (a == b) {
            assertEq(Math256.ceilDiv(a, b), 1);
            assertEq(Math256.ceilDiv(b, a), 1);
        }

        // It shouldn't crash unexpectedly
        Math256.ceilDiv(a, b);
    }

    /// tests for absDiff

    function testAbsDiffZeros() public {
        uint256 a = 0;
        uint256 b = 0;

        assertEq(Math256.absDiff(b, a), 0);
    }

    function testAbsDiffOnes() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.absDiff(b, a), 0);
    }

    function testAbsDiffFuzz(uint256 a, uint256 b) public {
        // If they are the same, it's always zero
        if (a == b) {
            assertEq(Math256.absDiff(b, a), 0);
        }

        // If one is zero, the difference should always be the other
        if (a == 0) {
            assertEq(Math256.absDiff(b, a), b);
        }

        // It shouldn't unexpectedly crash
        Math256.absDiff(b, a);
    }