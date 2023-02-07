// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
// solhint-disable-next-line lido/fixed-compiler-version
pragma solidity >=0.4.24 <0.9.0;

library UnstructuredStorageMap {
    function getStorageMappingUint256(bytes32 position, uint256 key) internal view returns (uint256 data) {
        return getStorageMappingUint256Offset(position, key, 0);
    }

    function getStorageMappingUint256Offset(bytes32 position, uint256 key, uint256 offset)
        internal
        view
        returns (uint256 data)
    {
        assembly {
            mstore(0, key)
            mstore(32, position)
            let hash := add(keccak256(0, 64), offset)
            data := sload(hash)
        }
    }

    function setStorageMappingUint256(bytes32 position, uint256 key, uint256 data) internal {
        setStorageMappingUint256Offset(position, key, 0, data);
    }

    function setStorageMappingUint256Offset(bytes32 position, uint256 key, uint256 offset, uint256 data) internal {
        assembly {
            mstore(0, key)
            mstore(32, position)
            let hash := add(keccak256(0, 64), offset)
            sstore(hash, data)
        }
    }
}
