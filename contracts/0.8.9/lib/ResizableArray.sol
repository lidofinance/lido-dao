// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


import { MemUtils } from "./MemUtils.sol";


/// Implements a "resizable" memory array by pre-allocating extra memory and copying the data
/// to a new memory region when pre-allocated memory is exhausted. Supports configuring the
/// pre-allocated memory growth factor and maximum one-time increase.
///
library ResizableArray {

    /// @notice A struct holding the array internal representation. Don't mutate the contents
    /// of this struct directly, use the functions below instead.
    ///
    struct Array {
        // Pointer to the 32-byte memory slot holding the array length. Since we're keeping
        // compatibility with the Solidity memory arrays, the array contents is laid out in
        // memory continuously starting from the next 32-byte slot.
        uint256 _memPtr;

        // A packed storage of the growth config and the currently preallocated length.
        // MSB ------------------------------ LSB
        //   2 bytes       6 bytes     24 bytes
        // growthFactor | maxGrowth | preallocLen
        uint256 _state;
    }

    /// @notice Pre-allocates memory for a resizable array.
    ///
    /// @param preallocLen How many items to pre-allocate. If the array exceeds this length,
    ///        a new memory region will be allocated and the array contents will be copied
    ///        to that region.
    ///
    /// @returns The Array memory struct holding the array internal representation.
    ///
    function preallocate(uint256 preallocLen) internal pure returns (Array memory) {
        return preallocate(preallocLen, 200, preallocLen * 10);
    }

    /// @notice Pre-allocates memory for a resizable array.
    ///
    /// @param preallocLen How many items to pre-allocate. If the array exceeds this length,
    ///        a new memory region will be allocated and the array contents will be copied
    ///        to that region.
    ///
    /// @param growthFactor Sets the multiplicator by which the pre-allocated memory size
    ///        is increased after the previously allocated region is exhausted. The multiplicator
    ///        is expressed in percents, 110 being equal the factor of 1.1, 200 being equal the
    ///        factor of 2.0, and so on. Must be greater than 100.
    ///
    /// @param maxGrowth Limits the maximum absolute one-time increase in the pre-allocated
    ///        memory size. Zero means no limit.
    ///
    /// @returns The Array memory struct holding the array internal representation.
    ///
    function preallocate(uint256 preallocLen, uint256 growthFactor, uint256 maxGrowth)
        internal pure returns (Array memory)
    {
        require(preallocLen > 0);
        require(growthFactor > 100);

        uint256 memPtr = _malloc(preallocLen);
        uint256 state = _encodeState(preallocLen, growthFactor, maxGrowth);

        return Array(memPtr, state);
    }

    /// @notice Returns length of the array.
    ///
    function length(Array memory self) internal pure returns (uint256 len) {
        uint256 memPtr = self._memPtr;
        assembly {
            len := mload(memPtr)
        }
    }

    /// @notice Returns memory pointer to the array.
    ///
    function pointer(Array memory self) internal pure returns (uint256[] memory result) {
        uint256 memPtr = self._memPtr;
        assembly {
            result := memPtr
        }
    }

    /// @notice Returns the maximum number of items that the currently
    ///         pre-allocated memory region can hold.
    ///
    function getPreallocatedLength(Array memory self) internal pure returns (uint256) {
        return _decodeAllocLen(self._state);
    }

    /// @notice Returns the memory growth factor (see the docs for `preallocate`).
    ///
    function getGrowthFactor(Array memory self) internal pure returns (uint256) {
        return _decodeGrowthFactor(self._state);
    }

    /// @notice Returns the max one-time growth of the pre-allocated memory (see
    ///         the docs for `preallocate`).
    ///
    function getMaxGrowth(Array memory self) internal pure returns (uint256) {
        return _decodeMaxGrowth(self._state);
    }

    /// @notice Adds an item to the end of the array.
    ///
    /// @param item The item to add.
    ///
    function push(Array memory self, uint256 item) internal pure {
        uint256 memPtr = self._memPtr;
        uint256 prevLen = length(self);
        uint256 allocLen = _decodeAllocLen(self._state);

        if (prevLen == allocLen) {
            // need to allocate new memory region and copy the contents there
            uint256 growthFactor = _decodeGrowthFactor(self._state);
            uint256 maxGrowth = _decodeMaxGrowth(self._state);
            uint256 growth = allocLen * (growthFactor - 100) / 100;
            if (growth == 0) {
                growth = 1;
            } else if (maxGrowth != 0 && growth > maxGrowth) {
                growth = maxGrowth;
            }
            allocLen += growth;
            memPtr = _malloc(allocLen);
            unchecked {
                MemUtils.memcpy(self._memPtr + 32, memPtr + 32, prevLen * 32);
            }
            self._memPtr = memPtr;
            self._state = _updateAllocLen(self._state, allocLen);
        }

        assembly {
            mstore(memPtr, add(prevLen, 1))
            let itemLoc := add(memPtr, add(32, mul(prevLen, 32)))
            mstore(itemLoc, item)
        }
    }

    /// @notice Removes the last item from the array.
    ///
    /// @returns The removed item.
    ///
    function pop(Array memory self) internal pure returns (uint256 result) {
        uint256 memPtr = self._memPtr;
        uint256 newLen = length(self) - 1;
        assembly {
            let itemLoc := add(memPtr, add(32, mul(newLen, 32)))
            result := mload(itemLoc)
            mstore(memPtr, newLen)
        }
    }

    /// @notice Decreases the array length by the specified number of items.
    ///
    /// @param trimBy By how many items to decrease the array length.
    ///
    function trim(Array memory self, uint256 trimBy) internal pure {
        uint256 memPtr = self._memPtr;
        uint256 newLen = length(self) - trimBy;
        assembly {
            mstore(memPtr, newLen)
        }
    }

    /// @notice Sets the array length to zero.
    ///
    function clear(Array memory self) internal pure {
        uint256 memPtr = self._memPtr;
        assembly {
            mstore(memPtr, 0)
        }
    }

    function _malloc(uint256 len) private pure returns (uint256 memPtr) {
        assembly {
            memPtr := mload(0x40)
            mstore(memPtr, 0)
            mstore(0x40, add(memPtr, add(32, mul(len, 32))))
        }
    }

    function _encodeState(uint256 allocLen, uint256 growthFactor, uint256 maxGrowth)
        private pure returns (uint256)
    {
        require(allocLen <= type(uint192).max);
        require(growthFactor <= type(uint16).max);
        require(maxGrowth <= type(uint48).max);
        unchecked {
            return allocLen + (maxGrowth << 192) + (growthFactor << 240);
        }
    }

    function _decodeAllocLen(uint256 state) private pure returns (uint256) {
        return uint192(state);
    }

    function _decodeMaxGrowth(uint256 state) private pure returns (uint256) {
        return uint48(state >> 192);
    }

    function _decodeGrowthFactor(uint256 state) private pure returns (uint256) {
        return uint16(state >> 240);
    }

    function _updateAllocLen(uint256 state, uint256 allocLen) private pure returns (uint256) {
        require(allocLen <= type(uint192).max);
        unchecked {
            return (state & ~uint256(type(uint192).max)) + allocLen;
        }
    }
}
