// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


import { ResizableArray as RA } from "../../lib/ResizableArray.sol";


contract ResizableArrayTest {
    using RA for RA.Array;

    uint256 internal constant A = uint256(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa);
    uint256 internal constant B = uint256(0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb);
    uint256 internal constant C = uint256(0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc);
    uint256 internal constant D = uint256(0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd);
    uint256 internal constant E = uint256(0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee);
    uint256 internal constant F = uint256(0x8deadbeeff00d4448deadbeeff00d4448deadbeeff00d4448deadbeeff00d444);
    uint256 internal constant X = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
    uint256 internal constant Y = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
    uint256 internal constant Z = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);

    ///
    /// Tests
    ///

    function test_uninitialized_representation_can_be_detected_via_is_invalid() external {
        RA.Array memory arr;
        assertTrue(arr.isInvalid());
        assertEqual(arr.getPreallocatedLength(), 0);
        assertEqual(arr.getGrowthFactor(), 0);
        assertEqual(arr.getMaxGrowth(), 0);
    }


    function test_uninitialized_representation_can_be_obtained_by_calling_invalid() external {
        RA.Array memory arr = RA.invalid();
        assertTrue(arr.isInvalid());
        assertEqual(arr.getPreallocatedLength(), 0);
        assertEqual(arr.getGrowthFactor(), 0);
        assertEqual(arr.getMaxGrowth(), 0);
    }


    function test_length_cannot_be_obtained_from_an_uninitialized_representation() external {
        RA.Array memory arr;
        // solhint-disable-next-line
        uint256 len = arr.length();
        revert RevertExpected();
    }


    function test_pointer_cannot_be_obtained_from_an_uninitialized_representation() external {
        RA.Array memory arr;
        // solhint-disable-next-line
        uint256[] memory result = arr.pointer();
        revert RevertExpected();
    }


    function test_push_cannot_be_called_on_an_uninitialized_representation() external {
        RA.Array memory arr;
        arr.push(A);
        revert RevertExpected();
    }


    function test_pop_cannot_be_called_on_an_uninitialized_representation() external {
        RA.Array memory arr;
        arr.pop();
        revert RevertExpected();
    }


    function test_trim_cannot_be_called_on_an_uninitialized_representation() external {
        RA.Array memory arr;
        arr.trim(1);
        revert RevertExpected();
    }


    function test_clear_cannot_be_called_on_an_uninitialized_representation() external {
        RA.Array memory arr;
        arr.clear();
        revert RevertExpected();
    }


    function test_preallocate_returns_array_of_zero_length() external {
        RA.Array memory arr = RA.preallocate(3, 200, 10);
        assertFalse(arr.isInvalid());
        assertArray(arr, new uint256[](0));
    }


    function test_preallocate_preallocates_the_required_array_size() external {
        RA.Array memory arr = RA.preallocate(3, 200, 10);
        assertEqual(arr.getPreallocatedLength(), 3);
    }


    function test_preallocate_sets_config_correctly() external {
        RA.Array memory arr = RA.preallocate(3, 200, 10);
        assertEqual(arr.getGrowthFactor(), 200);
        assertEqual(arr.getMaxGrowth(), 10);
    }


    function test_preallocate_reverts_when_called_with_zero_size() external {
        // solhint-disable-next-line
        RA.Array memory arr = RA.preallocate(0, 200, 10);
        revert RevertExpected();
    }


    function test_preallocate_reverts_when_called_with_growth_factor_0() external {
        // solhint-disable-next-line
        RA.Array memory arr = RA.preallocate(1, 0, 10);
        revert RevertExpected();
    }


    function test_preallocate_reverts_when_called_with_growth_factor_100() external {
        // solhint-disable-next-line
        RA.Array memory arr = RA.preallocate(1, 100, 10);
        revert RevertExpected();
    }


    function test_pop_reverts_on_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.pop();
        revert RevertExpected();
    }


    function test_pop_doesnt_revert_on_non_empty_array() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.pop();
        assertArrayLength(arr, 0);
    }


    function test_pop_reverts_on_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.pop();
        arr.pop();
        revert RevertExpected();
    }


    function test_pop_reverts_on_empty_array_case_3() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.push(B);
        arr.clear();
        arr.pop();
        revert RevertExpected();
    }


    function test_trim_reverts_on_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.trim(1);
        revert RevertExpected();
    }


    function test_trim_reverts_on_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.pop();
        arr.trim(1);
        revert RevertExpected();
    }


    function test_trim_reverts_on_trimming_more_than_length() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.push(B);
        arr.trim(3);
        revert RevertExpected();
    }


    function test_trim_by_zero_doesnt_modity_non_empty_array() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.push(B);
        arr.trim(0);
        assertArray(arr, a([A, B]));
    }


    function test_trim_by_zero_doesnt_modity_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.trim(0);
        assertEmptyArray(arr);
    }


    function test_trim_by_zero_doesnt_modity_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.pop();
        arr.trim(0);
        assertEmptyArray(arr);
    }


    function test_clear_doesnt_modity_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.clear();
        assertEmptyArray(arr);
    }


    function test_clear_doesnt_modity_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.push(A);
        arr.pop();
        arr.clear();
        assertEmptyArray(arr);
    }


    function test_clear_can_be_called_multiple_times() external {
        RA.Array memory arr = RA.preallocate(10, 200, 10);
        arr.clear();
        arr.clear();
        assertEmptyArray(arr);
    }


    function test_growth_factor_and_max_growth_are_respected_case_1() external {
        RA.Array memory arr = RA.preallocate(3, 200, 10);
        assertArrayLength(arr, 0);
        assertEqual(arr.getPreallocatedLength(), 3);

        arr.push(F);
        arr.push(F);
        arr.push(F);
        assertArrayLength(arr, 3);
        assertEqual(arr.getPreallocatedLength(), 3);

        arr.push(F);
        assertArrayLength(arr, 4);
        assertEqual(arr.getPreallocatedLength(), 6);

        arr.push(F);
        arr.push(F);
        assertArrayLength(arr, 6);
        assertEqual(arr.getPreallocatedLength(), 6);

        arr.push(F);
        assertArrayLength(arr, 7);
        assertEqual(arr.getPreallocatedLength(), 12);

        for (uint256 i = 0; i < 5; ++i) {
            arr.push(F);
        }
        assertArrayLength(arr, 12);
        assertEqual(arr.getPreallocatedLength(), 12);

        arr.push(F);
        assertArrayLength(arr, 13);
        assertEqual(arr.getPreallocatedLength(), 22);

        for (uint256 i = 0; i < 22 - 13; ++i) {
            arr.push(F);
        }
        assertArrayLength(arr, 22);
        assertEqual(arr.getPreallocatedLength(), 22);

        arr.push(F);
        assertArrayLength(arr, 23);
        assertEqual(arr.getPreallocatedLength(), 32);
    }


    function test_growth_factor_and_max_growth_are_respected_case_2() external {
        RA.Array memory arr = RA.preallocate(1, 150, 5);
        assertArrayLength(arr, 0);
        assertEqual(arr.getPreallocatedLength(), 1);

        arr.push(F);
        assertArrayLength(arr, 1);
        assertEqual(arr.getPreallocatedLength(), 1);

        arr.push(F);
        assertArrayLength(arr, 2);
        assertEqual(arr.getPreallocatedLength(), 2);

        arr.push(F);
        assertArrayLength(arr, 3);
        assertEqual(arr.getPreallocatedLength(), 3);

        arr.push(F);
        assertArrayLength(arr, 4);
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.push(F);
        assertArrayLength(arr, 5);
        assertEqual(arr.getPreallocatedLength(), 6);

        arr.push(F);
        assertArrayLength(arr, 6);
        assertEqual(arr.getPreallocatedLength(), 6);

        arr.push(F);
        assertArrayLength(arr, 7);
        assertEqual(arr.getPreallocatedLength(), 9);

        arr.push(F);
        arr.push(F);
        assertArrayLength(arr, 9);
        assertEqual(arr.getPreallocatedLength(), 9);

        arr.push(F);
        assertArrayLength(arr, 10);
        assertEqual(arr.getPreallocatedLength(), 13);

        arr.push(F);
        arr.push(F);
        arr.push(F);
        assertArrayLength(arr, 13);
        assertEqual(arr.getPreallocatedLength(), 13);

        arr.push(F);
        assertArrayLength(arr, 14);
        assertEqual(arr.getPreallocatedLength(), 18);

        arr.push(F);
        arr.push(F);
        arr.push(F);
        arr.push(F);
        assertArrayLength(arr, 18);
        assertEqual(arr.getPreallocatedLength(), 18);

        arr.push(F);
        assertArrayLength(arr, 19);
        assertEqual(arr.getPreallocatedLength(), 23);
    }


    function test_growth_factor_and_max_growth_are_respected_case_3() external {
        RA.Array memory arr = RA.preallocate(30, 300, 1000);
        assertArrayLength(arr, 0);
        assertEqual(arr.getPreallocatedLength(), 30);

        for (uint256 i = 0; i < 30; ++i) {
            arr.push(F);
        }
        assertArrayLength(arr, 30);
        assertEqual(arr.getPreallocatedLength(), 30);

        arr.push(F);
        assertArrayLength(arr, 31);
        assertEqual(arr.getPreallocatedLength(), 90);

        for (uint256 i = 0; i < 90 - 31; ++i) {
            arr.push(F);
        }
        assertArrayLength(arr, 90);
        assertEqual(arr.getPreallocatedLength(), 90);

        arr.push(F);
        assertArrayLength(arr, 91);
        assertEqual(arr.getPreallocatedLength(), 270);
    }


    function test_push_pop_and_trim_work_within_prealloc_range() external {
        RA.Array memory arr = RA.preallocate(5, 200, 10);
        assertEqual(arr.getPreallocatedLength(), 5);
        uint256 ptr = arr._memPtr;

        arr.push(A);
        assertArray(arr, a([A]));
        assertEqual(arr._memPtr, ptr);

        uint256 last = arr.pop();
        assertEqual(last, A);
        assertArray(arr, new uint256[](0));
        assertEqual(arr._memPtr, ptr);

        arr.push(B);
        arr.push(C);
        arr.push(D);
        assertArray(arr, a([B, C, D]));
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, D);
        assertArray(arr, a([B, C]));
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, C);
        assertArray(arr, a([B]));
        assertEqual(arr._memPtr, ptr);

        arr.push(A);
        arr.push(C);
        arr.push(D);
        arr.push(E);

        assertArray(arr, a([B, A, C, D, E]));
        assertEqual(arr.getPreallocatedLength(), 5);
        assertEqual(arr._memPtr, ptr);

        arr.trim(3);
        assertArray(arr, a([B, A]));
        assertEqual(arr.getPreallocatedLength(), 5);
        assertEqual(arr._memPtr, ptr);
    }


    function test_push_pop_and_trim_work_outside_of_prealloc_range_case_1() external {
        RA.Array memory arr = RA.preallocate(1, 200, 10);
        assertEmptyArray(arr);
        assertEqual(arr.getPreallocatedLength(), 1);

        arr.push(A);
        assertArray(arr, a([A]));
        assertEqual(arr.getPreallocatedLength(), 1);

        uint256 last = arr.pop();
        assertEqual(last, A);
        assertEmptyArray(arr);
        assertEqual(arr.getPreallocatedLength(), 1);

        arr.push(B);
        assertArray(arr, a([B]));
        assertEqual(arr.getPreallocatedLength(), 1);

        arr.push(C);
        assertArray(arr, a([B, C]));
        assertEqual(arr.getPreallocatedLength(), 2);

        last = arr.pop();
        assertEqual(last, C);
        assertArray(arr, a([B]));
        assertEqual(arr.getPreallocatedLength(), 2);

        arr.push(D);
        assertArray(arr, a([B, D]));
        assertEqual(arr.getPreallocatedLength(), 2);

        arr.push(E);
        assertArray(arr, a([B, D, E]));
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.trim(1);
        assertArray(arr, a([B, D]));
        assertEqual(arr.getPreallocatedLength(), 4);

        last = arr.pop();
        assertEqual(last, D);
        assertArray(arr, a([B]));
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.push(F);
        assertArray(arr, a([B, F]));
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.trim(2);
        assertEmptyArray(arr);
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.push(A);
        arr.push(B);
        arr.push(C);
        arr.push(D);
        assertArray(arr, a([A, B, C, D]));
        assertEqual(arr.getPreallocatedLength(), 4);

        arr.push(E);
        assertArray(arr, a([A, B, C, D, E]));
        assertEqual(arr.getPreallocatedLength(), 8);

        arr.push(F);
        assertArray(arr, a([A, B, C, D, E, F]));
        assertEqual(arr.getPreallocatedLength(), 8);

        last = arr.pop();
        assertEqual(last, F);
        assertArray(arr, a([A, B, C, D, E]));
        assertEqual(arr.getPreallocatedLength(), 8);

        last = arr.pop();
        assertEqual(last, E);
        assertArray(arr, a([A, B, C, D]));
        assertEqual(arr.getPreallocatedLength(), 8);

        arr.clear();
        assertEmptyArray(arr);
        assertEqual(arr.getPreallocatedLength(), 8);

        arr.push(X);
        assertArray(arr, a([X]));
        assertEqual(arr.getPreallocatedLength(), 8);
    }


    function test_push_pop_and_trim_work_outside_of_prealloc_range_with_no_mem_allocated_after() external {
        uint256[] memory expected3 = a([A, B, C]);
        uint256[] memory expected4 = a([A, B, C, D]);
        uint256[] memory expected6 = a([A, B, C, D, E, F]);
        uint256[] memory expected7 = a([A, B, C, D, E, F, X]);
        uint256[] memory expected9 = a([A, B, C, D, E, F, X, Y, Z]);
        uint256[] memory expected5_2 = a([A, B, C, D, X]);

        RA.Array memory arr = RA.preallocate(3, 200, 5);
        assertEqual(arr.getPreallocatedLength(), 3);
        uint256 ptr = arr._memPtr;

        arr.push(A);
        arr.push(B);
        arr.push(C);
        assertArray(arr, expected3);
        assertEqual(arr.getPreallocatedLength(), 3);
        assertEqual(arr._memPtr, ptr);

        arr.push(D);
        assertArray(arr, expected4);
        assertEqual(arr.getPreallocatedLength(), 6);
        assertEqual(arr._memPtr, ptr);

        arr.push(E);
        arr.push(F);
        assertArray(arr, expected6);
        assertEqual(arr.getPreallocatedLength(), 6);
        assertEqual(arr._memPtr, ptr);

        arr.push(X);
        assertArray(arr, expected7);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        arr.push(Y);
        arr.push(Z);
        assertArray(arr, expected9);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        uint256 last = arr.pop();
        assertEqual(last, Z);
        assertArrayLength(arr, 8);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, Y);
        assertArray(arr, expected7);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        arr.trim(3);
        assertArray(arr, expected4);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        arr.push(X);
        assertArray(arr, expected5_2);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, X);
        assertArray(arr, expected4);

        last = arr.pop();
        assertEqual(last, D);
        assertArrayLength(arr, 3);

        last = arr.pop();
        assertEqual(last, C);
        assertArrayLength(arr, 2);

        last = arr.pop();
        assertEqual(last, B);
        assertArrayLength(arr, 1);

        last = arr.pop();
        assertEqual(last, A);
        assertArrayLength(arr, 0);
    }


    function test_push_pop_and_trim_work_outside_of_prealloc_range_with_mem_allocated_after() external {
        uint256[] memory expected3 = a([A, B, C]);
        uint256[] memory expected4 = a([A, B, C, D]);
        uint256[] memory expected6 = a([A, B, C, D, E, F]);
        uint256[] memory expected7 = a([A, B, C, D, E, F, X]);
        uint256[] memory expected9 = a([A, B, C, D, E, F, X, Y, Z]);
        uint256[] memory expected5_2 = a([A, B, C, D, X]);

        RA.Array memory arr = RA.preallocate(3, 200, 5);
        assertEqual(arr.getPreallocatedLength(), 3);
        uint256 ptr = arr._memPtr;

        uint256[] memory alloc1 = a([uint256(1), uint256(2), uint256(3)]);
        arr.push(A);
        arr.push(B);
        arr.push(C);

        assertArray(arr, expected3);
        assertEqual(arr.getPreallocatedLength(), 3);
        assertEqual(arr._memPtr, ptr);

        arr.push(D);
        assertArray(arr, expected4);
        assertEqual(arr.getPreallocatedLength(), 6);
        assertAbove(arr._memPtr, ptr);
        ptr = arr._memPtr;

        arr.push(E);
        arr.push(F);
        assertArray(arr, expected6);
        assertEqual(arr.getPreallocatedLength(), 6);
        assertEqual(arr._memPtr, ptr);

        uint256[] memory alloc2 = a([uint256(4), uint256(5), uint256(6)]);
        arr.push(X);

        assertArray(arr, expected7);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertAbove(arr._memPtr, ptr);
        ptr = arr._memPtr;

        arr.push(Y);
        arr.push(Z);
        assertArray(arr, expected9);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        uint256 last = arr.pop();
        assertEqual(last, Z);
        assertArrayLength(arr, 8);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, Y);
        assertArray(arr, expected7);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        arr.trim(3);
        assertArray(arr, expected4);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        arr.push(X);
        assertArray(arr, expected5_2);
        assertEqual(arr.getPreallocatedLength(), 11);
        assertEqual(arr._memPtr, ptr);

        last = arr.pop();
        assertEqual(last, X);
        assertArray(arr, expected4);

        last = arr.pop();
        assertEqual(last, D);
        assertArrayLength(arr, 3);

        last = arr.pop();
        assertEqual(last, C);
        assertArrayLength(arr, 2);

        last = arr.pop();
        assertEqual(last, B);
        assertArrayLength(arr, 1);

        last = arr.pop();
        assertEqual(last, A);
        assertArrayLength(arr, 0);

        // check no memory corruption occurred

        assertPlainArray(alloc1, a([uint256(1), uint256(2), uint256(3)]));
        assertPlainArray(alloc2, a([uint256(4), uint256(5), uint256(6)]));
    }

    ///
    /// Assertions
    ///

    error RevertExpected();
    error AssertAboveFailed(uint256 shouldBeAbove, uint256 shouldBeBelow);
    error AssertEqualFailed(uint256 actual, uint256 expected);
    error AssertFailed();
    error AssertArrayFailed(uint256[] actual, uint256[] expected);
    error AssertArrayLengthFailed(uint256 actual, uint256 expected);

    function assertTrue(bool value) internal pure {
        if (!value) {
            revert AssertFailed();
        }
    }

    function assertFalse(bool value) internal pure {
        if (value) {
            revert AssertFailed();
        }
    }

    function assertEqual(uint256 actual, uint256 expected) internal pure {
        if (actual != expected) {
            revert AssertEqualFailed(actual, expected);
        }
    }

    function assertAbove(uint256 shouldBeAbove, uint256 shouldBeBelow) internal pure {
        if (shouldBeAbove <= shouldBeBelow) {
            revert AssertAboveFailed(shouldBeAbove, shouldBeBelow);
        }
    }

    function assertEmptyArray(RA.Array memory actual) internal pure {
        assertArrayLength(actual, 0);
    }

    function assertArray(RA.Array memory actual, uint256[] memory expected) internal pure {
        assertArrayLength(actual, expected.length);

        uint256[] memory arr = actual.pointer();

        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] != expected[i]) {
                revert AssertArrayFailed(arr, expected);
            }
        }
    }

    function assertPlainArray(uint256[] memory actual, uint256[] memory expected) internal pure {
        if (actual.length != expected.length) {
            revert AssertArrayFailed(actual, expected);
        }
        for (uint256 i = 0; i < actual.length; ++i) {
            if (actual[i] != expected[i]) {
                revert AssertArrayFailed(actual, expected);
            }
        }
    }

    function assertArrayLength(RA.Array memory actual, uint256 expectedLen) internal pure {
        if (actual.pointer().length != expectedLen) {
            revert AssertArrayLengthFailed(actual.pointer().length, expectedLen);
        }
        assertEqual(actual.length(), expectedLen);
    }

    ///
    /// Helpers
    ///

    function a(uint256[1] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](1);
        result[0] = arr[0];
    }

    function a(uint256[2] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](2);
        result[0] = arr[0];
        result[1] = arr[1];
    }

    function a(uint256[3] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](3);
        result[0] = arr[0];
        result[1] = arr[1];
        result[2] = arr[2];
    }

    function a(uint256[4] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](4);
        for (uint256 i = 0; i < 4; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[5] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](5);
        for (uint256 i = 0; i < 5; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[6] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](6);
        for (uint256 i = 0; i < 6; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[7] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](7);
        for (uint256 i = 0; i < 7; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[8] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](8);
        for (uint256 i = 0; i < 8; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[9] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](9);
        for (uint256 i = 0; i < 9; ++i) {
            result[i] = arr[i];
        }
    }

    function a(uint256[10] memory arr) internal pure returns (uint256[] memory result) {
        result = new uint256[](10);
        for (uint256 i = 0; i < 10; ++i) {
            result[i] = arr[i];
        }
    }

    event DebugFreeMemPtr(uint256 value);
    event DebugMemPtr(uint256 value);

    function debugFreeMemPtr() internal {
        uint256 freeMemPtr;
        assembly {
            freeMemPtr := mload(0x40)
        }
        emit DebugFreeMemPtr(freeMemPtr);
    }
}
