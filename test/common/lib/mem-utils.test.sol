// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "forge-std/Test.sol";
import { MemUtils } from "contracts/common/lib/MemUtils.sol";

contract MemUtilsTestFoundry is Test {
    ///
    /// unsafeAllocateBytes
    ///

    function test_unsafeAlloc_allocates_empty_byte_array() external {
        // disable all compiler optimizations by including an assembly block not marked as mem-safe
        assembly {
            mstore(0x00, 0x1)
        }

        uint256 preAllocFreeMemPtr = getFreeMemPtr();

        // assert free mem pointer is 32-byte aligned initially
        assertTrue(preAllocFreeMemPtr % 32 == 0);

        bytes memory arr = MemUtils.unsafeAllocateBytes(0);
        assert(arr.length == 0);
        assertEq(getMemPtr(arr), preAllocFreeMemPtr);

        uint256 freeMemPtr = getFreeMemPtr();
        assertEq(freeMemPtr, preAllocFreeMemPtr + 32);
    }

    function getFreeMemPtr() internal pure returns (uint256 result) {
        assembly {
            result := mload(0x40)
        }
    }

    function getMemPtr(bytes memory arr) internal pure returns (uint256 result) {
        assembly {
            result := arr
        }
    }
}
