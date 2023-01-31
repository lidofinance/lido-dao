// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;


library UnstructuredRefStorage {
    function storageAddressArray(bytes32 _position) internal view returns (
        address[] storage result
    ) {
        assembly { result.slot := _position }
    }

    function storageMapAddressUint256(bytes32 _position) internal view returns (
        mapping(address => uint256) storage result
    ) {
        assembly { result.slot := _position }
    }
}
