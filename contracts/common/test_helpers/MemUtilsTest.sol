// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


import { MemUtils } from "../lib/MemUtils.sol";

import "./Assertions.sol";


contract MemUtilsTest {
    function getDataPtr(bytes memory arr) internal pure returns (uint256 dataPtr) {
        assembly {
            dataPtr := add(arr, 32)
        }
    }

    function fill(bytes memory arr, bytes1 value) internal pure returns (bytes memory) {
        for (uint256 i = 0; i < arr.length; ++i) {
            arr[i] = value;
        }
        return arr;
    }

    ///
    /// unsafeAllocateBytes
    ///

    function unsafeAlloc_allocates_empty_byte_array() external pure {
        // disable all compiler optimizations by including an assembly block not marked as mem-safe
        assembly {
            mstore(0x00, 0x1)
        }

        uint256 preAllocFreeMemPtr = getFreeMemPtr();

        // assert free mem pointer is 32-byte aligned initially
        Assert.isTrue(preAllocFreeMemPtr % 32 == 0);

        bytes memory arr = MemUtils.unsafeAllocateBytes(0);
        Assert.empty(arr);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        uint256 freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32);
    }

    function unsafeAlloc_allocates_memory_and_advances_free_mem_pointer() external pure {
        // disable all compiler optimizations by including an assembly block not marked as mem-safe
        assembly {
            mstore(0x00, 0x1)
        }

        uint256 initialFreeMemPtr = getFreeMemPtr();
        uint256 preAllocFreeMemPtr = initialFreeMemPtr;

        // assert free mem pointer is 32-byte aligned initially
        Assert.isTrue(preAllocFreeMemPtr % 32 == 0);

        bytes memory arr = MemUtils.unsafeAllocateBytes(32);
        Assert.length(arr, 32);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);
        fill(arr, 0x11);

        uint256 freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(64);
        Assert.length(arr, 64);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);
        fill(arr, 0x22);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 64);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(32 * 10);
        Assert.length(arr, 32 * 10);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);
        fill(arr, 0x33);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32 * 10);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(32 * 100);
        Assert.length(arr, 32 * 100);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);
        fill(arr, 0x44);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32 * 100);

        Assert.mem(initialFreeMemPtr, freeMemPtr, abi.encodePacked(
            // array 1: length
            uint256(32),
            // array 1: data
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            // array 2: length
            uint256(64),
            // array 2: data
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            // array 3: length
            uint256(32 * 10),
            // array 3: data
            fill(new bytes(32 * 10), 0x33),
            // array 3: length
            uint256(32 * 100),
            // array 3: data
            fill(new bytes(32 * 100), 0x44)
        ));
    }

    function unsafeAlloc_pads_free_mem_pointer_to_32_bytes() external pure {
        // disable all compiler optimizations by including an assembly block not marked as mem-safe
        assembly {
            mstore(0x00, 0x1)
        }

        uint256 preAllocFreeMemPtr = getFreeMemPtr();

        // assert free mem pointer is 32-byte aligned initially
        Assert.isTrue(preAllocFreeMemPtr % 32 == 0);

        bytes memory arr = MemUtils.unsafeAllocateBytes(1);
        Assert.length(arr, 1);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        uint256 freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(20);
        Assert.length(arr, 20);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(60);
        Assert.length(arr, 60);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 64);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(32 * 10 + 1);
        Assert.length(arr, 32 * 10 + 1);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32 * 11);
        preAllocFreeMemPtr = freeMemPtr;

        arr = MemUtils.unsafeAllocateBytes(32 * 100 + 15);
        Assert.length(arr, 32 * 100 + 15);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 32 * 101);
    }

    function unsafeAlloc_handles_misaligned_free_mem_pointer_and_pads_to_32_bytes() external pure {
        uint256 freeMemPtr = getFreeMemPtr();

        // assert free mem pointer is 32-byte aligned initially
        Assert.isTrue(freeMemPtr % 32 == 0);

        // misalign the free mem pointer
        uint256 preAllocFreeMemPtr = incrementFreeMemPtr(3);

        bytes memory arr = MemUtils.unsafeAllocateBytes(32);
        Assert.length(arr, 32);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, (preAllocFreeMemPtr + 32 - 3) + 32 + 32);

        // misalign the free mem pointer
        preAllocFreeMemPtr = incrementFreeMemPtr(1);

        arr = MemUtils.unsafeAllocateBytes(120);
        Assert.length(arr, 120);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, (preAllocFreeMemPtr - 1) + 32 + 128);

        // misalign the free mem pointer
        preAllocFreeMemPtr = incrementFreeMemPtr(32 - 12);

        arr = MemUtils.unsafeAllocateBytes(128 + 12);
        Assert.length(arr, 128 + 12);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + 32 + 128 + 12);

        // misalign the free mem pointer
        preAllocFreeMemPtr = incrementFreeMemPtr(5);

        arr = MemUtils.unsafeAllocateBytes(0);
        Assert.empty(arr);
        Assert.equal(getMemPtr(arr), preAllocFreeMemPtr);

        freeMemPtr = getFreeMemPtr();
        Assert.equal(freeMemPtr, preAllocFreeMemPtr + (32 - 5) + 32);
    }

    ///
    /// memcpy
    ///

    function memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444),
            bytes32(0x5555555555555555555555555555555555555555555555555555555555555555)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst), 64);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            bytes32(0x5555555555555555555555555555555555555555555555555555555555555555)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes_from_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444),
            bytes32(0x5555555555555555555555555555555555555555555555555555555555555555),
            bytes32(0x6666666666666666666666666666666666666666666666666666666666666666)
        );

        MemUtils.memcpy(getDataPtr(src) + 4, getDataPtr(dst), 64);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111122222222),
            bytes32(0x2222222222222222222222222222222222222222222222222222222233333333),
            bytes32(0x6666666666666666666666666666666666666666666666666666666666666666)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_multiples_of_32b_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444),
            bytes32(0x5555555555555555555555555555555555555555555555555555555555555555)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst) + 4, 64);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x3333333311111111111111111111111111111111111111111111111111111111),
            bytes32(0x1111111122222222222222222222222222222222222222222222222222222222),
            bytes32(0x2222222255555555555555555555555555555555555555555555555555555555)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes_from_and_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444),
            bytes32(0x5555555555555555555555555555555555555555555555555555555555555555),
            bytes32(0x6666666666666666666666666666666666666666666666666666666666666666)
        );

        MemUtils.memcpy(getDataPtr(src) + 4, getDataPtr(dst) + 3, 64);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x4444441111111111111111111111111111111111111111111111111111111122),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222233),
            bytes32(0x3333336666666666666666666666666666666666666666666666666666666666)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst), 42);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222244444444444444444444444444444444444444444444)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_from_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444)
        );

        MemUtils.memcpy(getDataPtr(src) + 3, getDataPtr(dst), 42);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111222222),
            bytes32(0x2222222222222222222244444444444444444444444444444444444444444444)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst) + 3, 42);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x3333331111111111111111111111111111111111111111111111111111111111),
            bytes32(0x1111112222222222222222222244444444444444444444444444444444444444)
        ));
    }

    function memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_from_and_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333),
            bytes32(0x4444444444444444444444444444444444444444444444444444444444444444)
        );

        MemUtils.memcpy(getDataPtr(src) + 3, getDataPtr(dst) + 4, 42);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x3333333311111111111111111111111111111111111111111111111111111111),
            bytes32(0x1122222222222222222222222222444444444444444444444444444444444444)
        ));
    }

    function memcpy_copies_mem_chunks_shorter_than_32_bytes() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst), 5);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x1111111111222222222222222222222222222222222222222222222222222222)
        ));
    }

    function memcpy_copies_mem_chunks_shorter_than_32_bytes_from_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0xcccccccccccccccccccccccccccccccccc8badf00d1234eeeeeeeeeeeeeeeeee)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        MemUtils.memcpy(getDataPtr(src) + 17, getDataPtr(dst), 4);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x8badf00d22222222222222222222222222222222222222222222222222222222)
        ));
    }

    function memcpy_copies_mem_chunks_shorter_than_32_bytes_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        MemUtils.memcpy(getDataPtr(src), getDataPtr(dst) + 5, 5);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x2222222222111111111122222222222222222222222222222222222222222222)
        ));
    }

    function memcpy_copies_mem_chunks_shorter_than_32_bytes_from_and_to_a_non_32b_offset() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0xcccccccccccccccccccccccccccccccccc8badf00d1234eeeeeeeeeeeeeeeeee)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        MemUtils.memcpy(getDataPtr(src) + 17, getDataPtr(dst) + 3, 4);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x2222228badf00d22222222222222222222222222222222222222222222222222)
        ));
    }

    function memcpy_zero_length_is_handled_correctly() external pure {
        bytes memory src = abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111)
        );

        bytes memory dst = abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        );

        MemUtils.memcpy(getDataPtr(src) + 11, getDataPtr(dst) + 13, 0);

        Assert.equal(dst, abi.encodePacked(
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222)
        ));
    }

    ///
    /// keccakUint256Array
    ///

    function keccakUint256Array_calcs_keccak_over_a_uint_array() external pure {
        uint256[] memory array = new uint256[](5);
        array[0] = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
        array[1] = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
        array[2] = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);
        array[3] = uint256(0x4444444444444444444444444444444444444444444444444444444444444444);
        array[4] = uint256(0x5555555555555555555555555555555555555555555555555555555555555555);

        bytes32 expected = keccak256(abi.encodePacked(array));
        bytes32 actual = MemUtils.keccakUint256Array(array);

        Assert.equal(actual, expected);
    }

    function keccakUint256Array_calcs_keccak_over_an_empty_array() external pure {
        uint256[] memory array = new uint256[](0);

        bytes32 expected = keccak256(abi.encodePacked(array));
        bytes32 actual = MemUtils.keccakUint256Array(array);

        Assert.equal(actual, expected);
    }

    ///
    /// trimUint256Array
    ///

    function trimUint256Array_decreases_length_of_a_uint_array() external pure {
        uint256[] memory array = new uint256[](5);
        array[0] = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
        array[1] = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
        array[2] = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);
        array[3] = uint256(0x4444444444444444444444444444444444444444444444444444444444444444);
        array[4] = uint256(0x5555555555555555555555555555555555555555555555555555555555555555);

        MemUtils.trimUint256Array(array, 2);

        Assert.equal(array.length, 3);
        Assert.equal(array[0], uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
        Assert.equal(array[1], uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        Assert.equal(array[2], uint256(0x3333333333333333333333333333333333333333333333333333333333333333));

        Assert.equal(abi.encodePacked(array), abi.encodePacked(
            bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            bytes32(0x3333333333333333333333333333333333333333333333333333333333333333)
        ));
    }

    function trimUint256Array_allows_trimming_to_zero_length() external pure {
        uint256[] memory array = new uint256[](3);
        array[0] = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
        array[1] = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
        array[2] = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);

        MemUtils.trimUint256Array(array, 3);

        Assert.empty(array);
    }

    function trimUint256Array_reverts_on_trying_to_trim_by_more_than_length() external pure {
        uint256[] memory array = new uint256[](3);
        array[0] = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
        array[1] = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
        array[2] = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);

        MemUtils.trimUint256Array(array, 4);
        revert Assert.RevertExpected();
    }
}
