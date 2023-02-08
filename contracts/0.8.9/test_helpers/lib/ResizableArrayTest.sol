// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import { ResizableArray as RA } from "../../lib/ResizableArray.sol";

import "./Assertions.sol";


library AssertRA {
    using RA for RA.Array;

    function array(RA.Array memory actual, uint256[] memory expected) internal pure {
        if (actual.length() != expected.length) {
            revert Assert.AssertArrayFailed(actual.pointer(), expected);
        }
        Assert.array(actual.pointer(), expected);
    }

    function arrayLength(RA.Array memory actual, uint256 expectedLen) internal pure {
        if (actual.length() != expectedLen) {
            revert Assert.AssertArrayLengthFailed(actual.length(), expectedLen);
        }
        Assert.arrayLength(actual.pointer(), expectedLen);
    }

    function emptyArray(RA.Array memory actual) internal pure {
        arrayLength(actual, 0);
    }
}


contract ResizableArrayTest {
    using RA for RA.Array;

    error RevertExpected();

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
        Assert.isTrue(arr.isInvalid());
        Assert.equal(arr.maxLength(), 0);
    }


    function test_uninitialized_representation_can_be_obtained_by_calling_invalid() external {
        RA.Array memory arr = RA.invalid();
        Assert.isTrue(arr.isInvalid());
        Assert.equal(arr.maxLength(), 0);
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
        RA.Array memory arr = RA.preallocate(3);
        Assert.isFalse(arr.isInvalid());
        AssertRA.emptyArray(arr);
    }


    function test_preallocate_preallocates_the_required_array_size() external {
        RA.Array memory arr = RA.preallocate(3);
        Assert.equal(arr.maxLength(), 3);
    }


    function test_preallocate_reverts_when_called_with_zero_size() external {
        // solhint-disable-next-line
        RA.Array memory arr = RA.preallocate(0);
        revert RevertExpected();
    }


    function test_push_adds_an_element_case_1() external {
        RA.Array memory arr = RA.preallocate(1);
        arr.push(F);
        AssertRA.array(arr, dyn([F]));
    }


    function test_push_adds_an_element_case_2() external {
        RA.Array memory arr = RA.preallocate(5);
        arr.push(A);
        arr.push(B);
        AssertRA.array(arr, dyn([A, B]));
    }


    function test_push_adds_an_element_case_3() external {
        RA.Array memory arr = RA.preallocate(100);
        uint256[] memory expected = new uint256[](100);

        for (uint256 i = 0; i < 100; ++i) {
            arr.push(i + 1);
            expected[i] = i + 1;
        }

        AssertRA.array(arr, expected);
    }


    function test_push_past_preallocated_length_reverts_case_1() external {
        RA.Array memory arr = RA.preallocate(1);
        arr.push(F);
        arr.push(A);
        revert RevertExpected();
    }


    function test_push_allows_to_fill_all_preallocated_memory() external {
        RA.Array memory arr = RA.preallocate(5);
        for (uint256 i = 0; i < 5; ++i) arr.push(F);
        AssertRA.array(arr, dyn([F, F, F, F, F]));
    }


    function test_push_past_preallocated_length_reverts_case_2() external {
        RA.Array memory arr = RA.preallocate(5);
        for (uint256 i = 0; i < 5; ++i) arr.push(F);
        arr.push(B);
        revert RevertExpected();
    }


    function test_push_past_preallocated_length_reverts_case_3() external {
        RA.Array memory arr = RA.preallocate(100);

        for (uint256 i = 0; i < 100; ++i) {
            arr.push(i + 1);
        }

        arr.push(X);
        revert RevertExpected();
    }


    function test_push_past_preallocated_length_reverts_case_4() external {
        RA.Array memory arr = RA.preallocate(3);
        arr.push(F);
        arr.push(F);
        arr.push(F);
        arr.pop();
        arr.push(A);
        arr.push(B);
        revert RevertExpected();
    }


    function test_pop_reverts_on_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.pop();
        revert RevertExpected();
    }


    function test_pop_doesnt_revert_on_non_empty_array() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.pop();
        AssertRA.emptyArray(arr);
    }


    function test_pop_reverts_on_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.pop();
        arr.pop();
        revert RevertExpected();
    }


    function test_pop_reverts_on_empty_array_case_3() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.push(B);
        arr.clear();
        arr.pop();
        revert RevertExpected();
    }


    function test_trim_reverts_on_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.trim(1);
        revert RevertExpected();
    }


    function test_trim_reverts_on_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.pop();
        arr.trim(1);
        revert RevertExpected();
    }


    function test_trim_reverts_on_trimming_more_than_length() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.push(B);
        arr.trim(3);
        revert RevertExpected();
    }


    function test_trim_by_zero_doesnt_modify_non_empty_array() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.push(B);
        arr.trim(0);
        AssertRA.array(arr, dyn([A, B]));
    }


    function test_trim_by_zero_doesnt_modify_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.trim(0);
        AssertRA.emptyArray(arr);
    }


    function test_trim_by_zero_doesnt_modify_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.pop();
        arr.trim(0);
        AssertRA.emptyArray(arr);
    }


    function test_clear_doesnt_modify_empty_array_case_1() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.clear();
        AssertRA.emptyArray(arr);
    }


    function test_clear_doesnt_modify_empty_array_case_2() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.push(A);
        arr.pop();
        arr.clear();
        AssertRA.emptyArray(arr);
    }


    function test_clear_can_be_called_multiple_times() external {
        RA.Array memory arr = RA.preallocate(10);
        arr.clear();
        arr.clear();
        AssertRA.emptyArray(arr);
    }


    function test_array_manipulation_scenario_1() external {
        RA.Array memory arr = RA.preallocate(5);

        arr.push(A);
        AssertRA.array(arr, dyn([A]));

        uint256 last = arr.pop();
        Assert.equal(last, A);
        AssertRA.emptyArray(arr);

        arr.push(B);
        arr.push(C);
        arr.push(D);
        AssertRA.array(arr, dyn([B, C, D]));

        last = arr.pop();
        Assert.equal(last, D);
        AssertRA.array(arr, dyn([B, C]));

        last = arr.pop();
        Assert.equal(last, C);
        AssertRA.array(arr, dyn([B]));

        arr.push(A);
        arr.push(C);
        arr.push(D);
        arr.push(E);
        AssertRA.array(arr, dyn([B, A, C, D, E]));

        arr.trim(3);
        AssertRA.array(arr, dyn([B, A]));

        arr.clear();
        AssertRA.emptyArray(arr);
    }


    function test_array_manipulation_scenario_2() external {
        RA.Array memory arr = RA.preallocate(6);
        AssertRA.emptyArray(arr);

        arr.push(A);
        AssertRA.array(arr, dyn([A]));

        uint256 last = arr.pop();
        Assert.equal(last, A);
        AssertRA.emptyArray(arr);

        arr.push(B);
        AssertRA.array(arr, dyn([B]));

        arr.push(C);
        AssertRA.array(arr, dyn([B, C]));

        last = arr.pop();
        Assert.equal(last, C);
        AssertRA.array(arr, dyn([B]));

        arr.push(D);
        AssertRA.array(arr, dyn([B, D]));

        arr.push(E);
        AssertRA.array(arr, dyn([B, D, E]));

        arr.trim(1);
        AssertRA.array(arr, dyn([B, D]));

        last = arr.pop();
        Assert.equal(last, D);
        AssertRA.array(arr, dyn([B]));

        arr.push(F);
        AssertRA.array(arr, dyn([B, F]));

        arr.trim(2);
        AssertRA.emptyArray(arr);

        arr.push(A);
        arr.push(B);
        arr.push(C);
        arr.push(D);
        AssertRA.array(arr, dyn([A, B, C, D]));

        arr.push(E);
        AssertRA.array(arr, dyn([A, B, C, D, E]));

        arr.push(F);
        AssertRA.array(arr, dyn([A, B, C, D, E, F]));

        last = arr.pop();
        Assert.equal(last, F);
        AssertRA.array(arr, dyn([A, B, C, D, E]));

        last = arr.pop();
        Assert.equal(last, E);
        AssertRA.array(arr, dyn([A, B, C, D]));

        arr.clear();
        AssertRA.emptyArray(arr);

        arr.push(X);
        AssertRA.array(arr, dyn([X]));

        last = arr.pop();
        Assert.equal(last, X);
    }

    // Address of the memory "zero slot"
    // https://docs.soliditylang.org/en/v0.8.9/internals/layout_in_memory.html
    uint256 internal constant ZERO_MEM_SLOT_ADDR = 96;

    function test_array_manipulation_preserves_memory_safety() external {
        // disable all compiler optimizations by including an assembly block not marked as mem-safe
        assembly {
            mstore(0x00, 0x1)
        }

        // allocate some memory before the array
        uint256[] memory AB = dyn([A, B]);
        uint256[] memory ABX = dyn([A, B, X]);
        uint256[] memory ABCDEF = dyn([A, B, C, D, E, F]);

        // allocate the array
        uint256 preAllocFreeMemPtr = getFreeMemPtr();
        RA.Array memory arr = RA.preallocate(6);
        uint256 postAllocFreeMemPtr = getFreeMemPtr();

        Assert.atLeast(arr._memPtr, preAllocFreeMemPtr);
        Assert.above(postAllocFreeMemPtr, arr._memPtr);
        Assert.atLeast(postAllocFreeMemPtr, preAllocFreeMemPtr + _memSizeForArrayLength(6));

        // allocate some memory after the array
        uint256[] memory ABCDE = dyn([A, B, C, D, E]);
        uint256[] memory ABCD = dyn([A, B, C, D]);
        uint256[] memory YZF = dyn([Y, Z, F]);

        uint256 freeMemPtr = getFreeMemPtr();
        bytes32 prefixMemHash = memKeccak(ZERO_MEM_SLOT_ADDR, preAllocFreeMemPtr);
        bytes32 suffixMemHash = memKeccak(postAllocFreeMemPtr, freeMemPtr);

        AssertRA.emptyArray(arr);

        arr.push(A);
        arr.push(B);
        arr.push(C);
        arr.push(D);
        arr.push(E);
        arr.push(F);
        AssertRA.array(arr, ABCDEF);

        uint256 last = arr.pop();
        Assert.equal(last, F);
        AssertRA.array(arr, ABCDE);

        last = arr.pop();
        Assert.equal(last, E);
        AssertRA.array(arr, ABCD);

        arr.trim(2);
        AssertRA.array(arr, AB);

        arr.push(X);
        AssertRA.array(arr, ABX);

        last = arr.pop();
        Assert.equal(last, X);
        AssertRA.array(arr, AB);

        arr.clear();
        AssertRA.emptyArray(arr);

        arr.push(Y);
        arr.push(Z);
        arr.push(F);
        AssertRA.array(arr, YZF);

        // check no memory corruption occurred

        Assert.equal(getFreeMemPtr(), freeMemPtr);

        bytes32 newPrefixMemHash = memKeccak(ZERO_MEM_SLOT_ADDR, preAllocFreeMemPtr);
        bytes32 newSuffixMemHash = memKeccak(postAllocFreeMemPtr, freeMemPtr);

        Assert.equal(newPrefixMemHash, prefixMemHash);
        Assert.equal(newSuffixMemHash, suffixMemHash);
    }

    ///
    /// Helpers
    ///

    function _memSizeForArrayLength(uint256 numItems) internal pure returns (uint256) {
        return 32 + numItems * 32;
    }

    function getFreeMemPtr() internal pure returns (uint256 result) {
        assembly {
            result := mload(0x40)
        }
    }

    function memKeccak(uint256 start, uint256 pastEnd) internal pure returns (bytes32 result) {
        uint256 len = pastEnd - start;
        assembly {
            result := keccak256(start, len)
        }
    }
}
