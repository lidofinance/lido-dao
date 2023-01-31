// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


import { MemUtils } from "../lib/MemUtils.sol";


contract MemUtilsTest {
    error BytesDontMatch(bytes actual, bytes expected);
    error HashesDontMatch(bytes32 actual, bytes32 expected);
    error AssertUintEqualFailed(string msg, uint256 actual, uint256 expected);

    function getDataPtr(bytes memory arr) internal pure returns (uint256 dataPtr) {
        assembly {
            dataPtr := add(arr, 32)
        }
    }

    function assertBytes(bytes memory actual, bytes memory expected) internal pure {
        if (keccak256(actual) != keccak256(expected)) {
            revert BytesDontMatch(actual, expected);
        }
    }

    function assertUint(uint256 actual, uint256 expected, string memory msg) internal pure {
        if (actual != expected) {
            revert AssertUintEqualFailed(msg, actual, expected);
        }
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
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

        assertBytes(dst, abi.encodePacked(
            bytes32(0x2222228badf00d22222222222222222222222222222222222222222222222222)
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

        if (actual != expected) {
            revert HashesDontMatch(actual, expected);
        }
    }

    function keccakUint256Array_calcs_keccak_over_an_empty_array() external pure {
        uint256[] memory array = new uint256[](0);

        bytes32 expected = keccak256(abi.encodePacked(array));
        bytes32 actual = MemUtils.keccakUint256Array(array);

        if (actual != expected) {
            revert HashesDontMatch(actual, expected);
        }
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

        assertUint(array.length, 3, "array.length");
        assertUint(array[0], uint256(0x1111111111111111111111111111111111111111111111111111111111111111), "array[0]");
        assertUint(array[1], uint256(0x2222222222222222222222222222222222222222222222222222222222222222), "array[1]");
        assertUint(array[2], uint256(0x3333333333333333333333333333333333333333333333333333333333333333), "array[2]");

        assertBytes(abi.encodePacked(array), abi.encodePacked(
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

        assertUint(array.length, 0, "array.length");
        assertBytes(abi.encodePacked(array), new bytes(0));
    }

    function trimUint256Array_reverts_on_trying_to_trim_by_more_than_length() external pure {
        uint256[] memory array = new uint256[](3);
        array[0] = uint256(0x1111111111111111111111111111111111111111111111111111111111111111);
        array[1] = uint256(0x2222222222222222222222222222222222222222222222222222222222222222);
        array[2] = uint256(0x3333333333333333333333333333333333333333333333333333333333333333);

        MemUtils.trimUint256Array(array, 4);
    }
}
