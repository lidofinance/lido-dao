pragma solidity 0.8.9;

import "forge-std/Test.sol";
import { Math } from "contracts/0.8.9/lib/Math.sol";

contract MathTest is Test {

    /// uint256 tests for max

    function testMaxUint256_a_b() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math.max(a, b), b);
    }

    function testMaxUint256_b_a() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math.max(b, a), b);
    }

    function testMaxUint256_a_b_equal() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math.max(b, a), b);
    }

    function testMaxUint256Fuzz(uint256 a, uint256 b) public {
        uint256 expected;

        if (a > b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must be commutative
        assertEq(Math.min(b, a), Math.min(a, b));

        // Must be expected
        assertEq(Math.max(b, a), expected);
    }

    function testMinUint256_a_b() public {
        uint256 a = 2;
        uint256 b = 1;

        assertEq(Math.min(a, b), b);
    }

    function testMinUint256_b_a() public {
        uint256 a = 1;
        uint256 b = 2;

        assertEq(Math.min(b, a), a);
    }

    function testMinUint256_a_b_equal() public {
        uint256 a = 1;
        uint256 b = 1;

        assertEq(Math.max(b, a), b);
    }

    function testUint256MinFuzz(uint256 a, uint256 b) public {
        uint256 expected;

        if (a < b) {
            expected = a;
        } else {
            expected = b;
        }

        // Must be commutative
        assertEq(Math.min(b, a), Math.min(a, b));

        // Must be expected
        assertEq(Math.min(b, a), expected);
    }

    /// uint256 tests for pointInClosedIntervalModN

    function testPointInClosedIntervalModNNegative() public {
        uint256 x = 4;
        uint256 a = 1;
        uint256 b = 1;
        uint256 n = 4;

        assertEq(Math.pointInClosedIntervalModN(x, a, b, n), false);
    }

    function testPointInClosedIntervalModNPositive() public {
        uint256 x = 2439649222;
        uint256 a = 462;
        uint256 b = 676;
        uint256 n = 929;

        assertEq(Math.pointInClosedIntervalModN(x, a, b, n), true);
    }

    function testPointInClosedIntervalModNFuzz(uint256 x, uint256 a, uint256 b, uint256 n) public {
        // ignore obvious underflow conditions between n, a, and b
        vm.assume(b > a);

        // ignore obvious overflow conditions between X and N
        uint256 remainX = type(uint256).max - x;
        uint256 remainN = type(uint256).max - n;
        vm.assume(n <= remainX);
        vm.assume(x <= remainN);

        // ignore additional underflow conditions between x, n, a
        vm.assume((x + n) >= a);

        // ignore divison by zero conditions of N
        vm.assume(n != 0);

        // reimplement logic looking for emergents and lock in behavior
        if (((x + n - a) % n) <= ((b - a) % n)) {
            assertEq(Math.pointInClosedIntervalModN(x, a, b, n), true);
        } else {
            assertEq(Math.pointInClosedIntervalModN(x, a, b, n), false);
        }
    }
}