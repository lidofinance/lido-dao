// SPDX-License-Identifier: MIT
pragma solidity >=0.4.24 <0.9.0;

import "forge-std/Test.sol";
import {ECDSA} from "contracts/common/lib/ECDSA.sol";
import { UnstructuredStorage } from "contracts/0.8.9/lib/UnstructuredStorage.sol";

contract ExposedUnstructuredStorage {
    function _getStorageBool(bytes32 position) public returns (bool) {
        return UnstructuredStorage.getStorageBool(position);
    }

    function _getStorageAddress(bytes32 position) public returns (address) {
        return UnstructuredStorage.getStorageAddress(position);
    }

    function _getStorageBytes32(bytes32 position) public returns (bytes32) {
        return UnstructuredStorage.getStorageBytes32(position);
    }

    function _getStorageUint256(bytes32 position) public returns (uint256) {
        return UnstructuredStorage.getStorageUint256(position);
    }

    function _setStorageBool(bytes32 position, bool data) public {
        return UnstructuredStorage.setStorageBool(position, data);
    }

    function _setStorageAddress(bytes32 position, address data) public {
        return UnstructuredStorage.setStorageAddress(position, data);
    }

    function _setStorageBytes32(bytes32 position, bytes32 data) public {
        return UnstructuredStorage.setStorageBytes32(position, data);
    }

    function _setStorageUint256(bytes32 position, uint256 data) public {
        return UnstructuredStorage.setStorageUint256(position, data);
    }
}

contract ExposedUnstructuredStorageTest is Test {
    ExposedUnstructuredStorage public unstructedStorage;

    function setUp() public {
        unstructedStorage = new ExposedUnstructuredStorage();
    }

    function testGetStorageBool() public {
        bytes32 position = keccak256("FOO"); 
        assertEq(unstructedStorage._getStorageBool(position), false);
    }

    function testGetStorageAddress() public {
        bytes32 position = keccak256("FOO");
        assertEq(unstructedStorage._getStorageAddress(position), address(0));
    }

    function testGetStorageBytes32() public {
        bytes32 position = keccak256("FOO");
        bytes32 data;
        assertEq(unstructedStorage._getStorageBytes32(position), data);
    }

    function testGetStorageUint256() public {
        bytes32 position = keccak256("FOO");
        uint256 data;
        assertEq(unstructedStorage._getStorageUint256(position), data);
    }

    function testSetStorageBool() public {
        bytes32 position = keccak256("FOO");
        assertEq(unstructedStorage._getStorageBool(position), false);

        unstructedStorage._setStorageBool(position, true);
        assertEq(unstructedStorage._getStorageBool(position), true);

        unstructedStorage._setStorageBool(position, false);
        assertEq(unstructedStorage._getStorageBool(position), false);
    }

    function testSetStorageAddress() public {
        bytes32 position = keccak256("FOO");
        address data = vm.addr(1);

        assertEq(unstructedStorage._getStorageAddress(position), address(0));
        unstructedStorage._setStorageAddress(position, data);
        assertEq(unstructedStorage._getStorageAddress(position), data);
    }

    function testSetStorageAddressFuzz(uint256 num) public {
        // Private key must be greater than zero
        vm.assume(num > 0);
        
        // Private key must be less than the secp256k1 curve order
        vm.assume(num < 115792089237316195423570985008687907852837564279074904382605163141518161494337);

        bytes32 position = keccak256("FOO");
        address data = vm.addr(num);

        assertEq(unstructedStorage._getStorageAddress(position), address(0));
        unstructedStorage._setStorageAddress(position, data);
        assertEq(unstructedStorage._getStorageAddress(position), data);
    }

    function testSetStorageBytes32() public {
        bytes32 position = keccak256("FOO");
        bytes32 data = keccak256("BAR");
        bytes32 unintializedData;

        assertEq(unstructedStorage._getStorageBytes32(position), unintializedData);
        unstructedStorage._setStorageBytes32(position, data);
        assertEq(unstructedStorage._getStorageBytes32(position), data);
    }

    function testSetStorageUint256() public {
        bytes32 position = keccak256("FOO");
        uint256 data = 1;
        uint256 unintializedData;

        assertEq(unstructedStorage._getStorageUint256(position), unintializedData);
        unstructedStorage._setStorageUint256(position, data);
        assertEq(unstructedStorage._getStorageUint256(position), data);
    }

    function testSetStorageUint256Fuzz(uint256 data) public {
        bytes32 position = keccak256("FOO");
        uint256 unintializedData;

        assertEq(unstructedStorage._getStorageUint256(position), unintializedData);
        unstructedStorage._setStorageUint256(position, data);
        assertEq(unstructedStorage._getStorageUint256(position), data);
    }

}