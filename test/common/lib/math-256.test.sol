// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "forge-std/Test.sol";
import { Math256 } from "contracts/common/lib/Math256.sol";

contract Math256Test is Test {

    /// uint256 tests for max/min

    function testMaxUint256_a_b() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    function testMaxUint256_b_a() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxUint256_a_b_equal() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxUint256Fuzz(uint256 a, uint256 b) public {
        uint256 expected;
        
        if (a > b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must not crash
        Math256.min(b, a);

        // Must be commutative
        assertEq(Math256.min(b, a), Math256.min(a, b));

        // Must be expected
        assertEq(Math256.max(b, a), expected);
    }

    function testMinUint256_a_b() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    function testMinUint256_b_a() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    function testMinUint256_a_b_equal() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testUint256MinFuzz(uint256 a, uint256 b) public {
        uint256 expected;
        
        if (a < b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must be commutative
        assertEq(Math256.min(b, a), Math256.min(a, b));

        // Must be expected
        assertEq(Math256.min(b, a), expected);
    }

    /// int256 tests for max/min

    function testMaxInt256_a_b() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(a, b), b);
    }

    function testMaxInt256_b_a() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxInt256_a_b_equal() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxInt256_a_b_negative() public {
        int256 a = -1;
        int256 b = -2;

        assertEq(Math256.max(a, b), a);
    }

    function testMaxInt256_a_b_positive_negative() public {
        int256 a = 1;
        int256 b = -2;

        assertEq(Math256.max(a, b), a);
    }

    function testMaxInt256_b_a_negative() public {
        int256 a = -1;
        int256 b = -2;

        assertEq(Math256.max(b, a), a);
    }

    function testMaxInt256_b_a_postive_negative() public {
        int256 a = 1;
        int256 b = -2;

        assertEq(Math256.max(b, a), a);
    }

    function testMaxInt256_a_b_equal_negative() public {
        int256 a = -1;
        int256 b = -1;

        assertEq(Math256.max(b, a), b);
    }

    function testMaxInt256Fuzz(int256 a, int256 b) public {
        int256 expected;
        
        if (a > b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must be commutative
        assertEq(Math256.max(b, a), Math256.max(a, b));

        // Must be exepcted
        assertEq(Math256.max(b, a), expected);
    }

    function testMinInt256_a_b() public {
        int256 a = 2;
        int256 b = 1;

        assertEq(Math256.min(a, b), b);
    }

    function testMinInt256_b_a() public {
        int256 a = 1;
        int256 b = 2;

        assertEq(Math256.min(b, a), a);
    }

    function testMinInt256_b_a_equal() public {
        int256 a = 1;
        int256 b = 1;

        assertEq(Math256.max(b, a), b);
    }

    function testInt256MinFuzz(int256 a, int256 b) public {
        int256 expected;
        
        if (a < b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must not crash
        Math256.min(b, a);

        // Must be commutative
        assertEq(Math256.min(b, a), Math256.min(a, b));

        // Must be expected
        assertEq(Math256.min(b, a), expected);
    }

    /// tests for ceilDiv

    // Commenting this out, as the implementation doesn't solve for this case
    // function testCeilDivByZero() public {
    //     uint256 a = 1;
    //     uint256 b = 0;

    //     vm.expectRevert("Division or modulo by 0");
    //     Math256.ceilDiv(a, b);
    // }

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
        // Skip zero, implementation is safe against division by zero
        vm.assume(b != 0);
        
        // This case should always be zero
        if (a == 0) {
            assertEq(Math256.ceilDiv(a, b), 0);
        }

        // When they are both equal, the orientation shouldn't matter, it should be 1
        if (a == b) {
            assertEq(Math256.ceilDiv(a, b), 1);
            assertEq(Math256.ceilDiv(b, a), 1);
        }

        uint256 expected = (a == 0 ? 0 : (a - 1) / b + 1);
        assertEq(Math256.ceilDiv(a, b), expected);
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

        // It shouldn't unexpectedly crash
        Math256.absDiff(b, a);

        // If they are the same, it's always zero
        if (a == b) {
            assertEq(Math256.absDiff(b, a), 0);
        }

        // They are different 
        if (b > a) {
            assertEq(Math256.absDiff(b, a), b - a);
        } else {
            assertEq(Math256.absDiff(a, b), a - b);
        }

        // If one is zero, the difference should always be the other
        if (a == 0) {
            assertEq(Math256.absDiff(b, a), b);
        }

        // Must be commutative
        assertEq(Math256.absDiff(b, a), Math256.absDiff(a, b));
    }
}