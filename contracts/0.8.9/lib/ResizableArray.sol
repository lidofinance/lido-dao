// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: MIT

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;


/// @notice Implements a "resizable" uint256 memory array by pre-allocating the memory upfront.
/// The array cannot grow past its pre-allocated length.
///
library ResizableArray {
    error Uninitialized();
    error MaxLengthCannotBeZero();
    error MaxLengthReached();
    error ArrayIsEmpty();
    error CannotTrimMoreThanLength();

    /// @dev A struct holding the array internal representation.
    ///
    /// Don't read or mutate the contents of this struct directly, use the functions below
    /// instead.
    ///
    struct Array {
        // Pointer to the 32-byte memory slot holding the array length. Since we're keeping
        // compatibility with the Solidity memory arrays, the array contents is laid out in
        // memory continuously starting from the next 32-byte slot.
        uint256 _memPtr;

        // The pre-allocated length. The array cannot grow past this length.
        uint256 _maxLength;
    }

    /// @notice Returns an uninitialized internal representation.
    ///
    /// Can be used as a placeholder for a missing value. Cannot be initialized.
    ///
    function invalid() internal pure returns (Array memory) {
        return Array(0, 0);
    }

    /// @notice Returns whether the internal representation is uninitialized.
    ///
    function isInvalid(Array memory self) internal pure returns (bool) {
        return self._memPtr == 0;
    }

    /// @notice Pre-allocates memory for the array and returns an empty array.
    ///
    /// @param maxLength How many uint256 items to pre-allocate. Array length cannot
    ///        exceed the pre-allocated length.
    ///
    /// @return The Array memory struct holding the array internal representation.
    ///
    function preallocate(uint256 maxLength) internal pure returns (Array memory) {
        if (maxLength == 0) revert MaxLengthCannotBeZero();

        Array memory result;

        uint256 memPtr = _allocateArray(maxLength);
        result._memPtr = memPtr;
        result._maxLength = maxLength;

        /// @solidity memory-safe-assembly
        assembly {
            mstore(memPtr, 0)
        }

        return result;
    }

    /// @notice Returns length of the array.
    ///
    function length(Array memory self) internal pure returns (uint256 len) {
        uint256 memPtr = _getMemPtr(self);
        /// @solidity memory-safe-assembly
        assembly {
            len := mload(memPtr)
        }
    }

    /// @notice Returns a memory pointer to the array.
    ///
    function pointer(Array memory self) internal pure returns (uint256[] memory result) {
        uint256 memPtr = _getMemPtr(self);
        /// @solidity memory-safe-assembly
        assembly {
            result := memPtr
        }
    }

    /// @notice Returns the maximum number of uint256 items that the array can hold.
    ///
    function maxLength(Array memory self) internal pure returns (uint256) {
        return self._maxLength;
    }

    /// @notice Adds an item to the end of the array.
    ///
    /// @param item The item to add.
    ///
    function push(Array memory self, uint256 item) internal pure {
        uint256 memPtr = _getMemPtr(self);
        uint256 prevLen = length(self);

        if (prevLen == self._maxLength) {
            revert MaxLengthReached();
        }

        /// @solidity memory-safe-assembly
        assembly {
            mstore(memPtr, add(prevLen, 1))
            let itemLoc := add(memPtr, add(32, mul(prevLen, 32)))
            mstore(itemLoc, item)
        }
    }

    /// @notice Removes the last item from the array.
    ///
    /// @return result The removed item.
    ///
    function pop(Array memory self) internal pure returns (uint256 result) {
        uint256 memPtr = self._memPtr;
        uint256 prevLen = length(self);
        if (prevLen == 0) {
            revert ArrayIsEmpty();
        }
        /// @solidity memory-safe-assembly
        assembly {
            let newLen := sub(prevLen, 1)
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
        uint256 prevLen = length(self);
        if (prevLen < trimBy) {
            revert CannotTrimMoreThanLength();
        }
        /// @solidity memory-safe-assembly
        assembly {
            mstore(memPtr, sub(prevLen, trimBy))
        }
    }

    /// @notice Sets the array length to zero.
    ///
    function clear(Array memory self) internal pure {
        uint256 memPtr = _getMemPtr(self);
        /// @solidity memory-safe-assembly
        assembly {
            mstore(memPtr, 0)
        }
    }

    ///
    /// Helpers
    ///

    function _getMemPtr(Array memory self) private pure returns (uint256) {
        uint256 memPtr = self._memPtr;
        if (memPtr == 0) revert Uninitialized();
        return memPtr;
    }

    function _allocateArray(uint256 dataLenWords) private pure returns (uint256 memPtr) {
        /// @solidity memory-safe-assembly
        assembly {
            memPtr := mload(0x40)
            mstore(0x40, add(memPtr, add(32, mul(dataLenWords, 32))))
        }
    }
}
