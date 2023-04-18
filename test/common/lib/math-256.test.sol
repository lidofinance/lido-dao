// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import { Math256 } from "contracts/common/lib/MemUMath256.sol";

contract Math256Test is Test {

    /// int256 tests for max/min

    /// Simple max case: B greater than A 
    function testMaxUint256Simple1() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    /// Simple max case: A greater than B 
    function testMaxUint256Simple2() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    /// Simple max case: A equal to B 
    function testMaxUint256Simple3() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    /// Fuzzing max for A and B
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

    /// Simple min case: B less than A 
    function testMinUint256Simple1() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    /// Simple case: A less than B 
    function testMinUint256Simple2() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    /// Simple case: A equal to B 
    function testMinUint256Simple3() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    /// Fuzzing A and B
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

    /// Simple max case: B greater than A 
    function testMaxInt256Simple1() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    /// Simple max case: A greater than B 
    function testMaxInt256Simple2() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    /// Simple max case: A equal to B 
    function testMaxInt256Simple3() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    /// Fuzzing max for A and B
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

    /// Simple min case: B less than A 
    function testMinInt256Simple1() public {
        int256 a = 2;
        int256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    /// Simple case: A less than B 
    function testMinInt256Simple2() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    /// Simple case: A equal to B 
    function testMinInt256Simple3() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    /// Fuzzing A and B
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

    /// Simple case: division by zero
    function testCeilDivByZero() public {
        uint256 a = 1;
        uint256 b = 0;

        vm.expectRevert("Division or modulo by 0");
        Math256.ceilDiv(a, b);
    }

    /// Simple case: zero divided by x
    function testCeilDivZeroFromFour() public {
        uint256 a = 0;
        uint256 b = 4;
        assertEq(Math256.ceilDiv(a, b), 0);
    }

    /// Simple case: division by 1
    function testCeilDivByOne() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math256.ceilDiv(a, b), a);
    }

    /// Simple case: division by 2
    function testCeilDivByTwo() public {
        uint256 a = 4;
        uint256 b = 2;

        assertEq(Math256.ceilDiv(a, b), b);
    }

    /// Simple case: division by 3 (demonstrating round up)
    function testCeilDivByThree() public {
        uint256 a = 4;
        uint256 b = 3;

        assertEq(Math256.ceilDiv(a, b), 2);
    }

    /// Fuzz case CeilDiv
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

    /// Simple case: absDiff of two zeros
    function testAbsDiffZeros() public {
        uint256 a = 0;
        uint256 b = 0;

        assertEq(Math256.absDiff(b, a), 0);
    }

    /// Simple case: absDiff of two ones
    function testAbsDiffOnes() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.absDiff(b, a), 0);
    }

    /// Simple case: absDiff of two ones
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

}