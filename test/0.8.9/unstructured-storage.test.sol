// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "forge-std/Test.sol";
import { UnstructuredStorage } from "contracts/0.8.9/lib/UnstructuredStorage.sol";

contract ExposedUnstructuredStorage {
    function getStorageBool(bytes32 position) public view returns (bool) {
        return UnstructuredStorage.getStorageBool(position);
    }

    function getStorageAddress(bytes32 position) public view returns (address) {
        return UnstructuredStorage.getStorageAddress(position);
    }

    function getStorageBytes32(bytes32 position) public view returns (bytes32) {
        return UnstructuredStorage.getStorageBytes32(position);
    }

    function getStorageUint256(bytes32 position) public view returns (uint256) {
        return UnstructuredStorage.getStorageUint256(position);
    }

    function setStorageBool(bytes32 position, bool data) public {
        return UnstructuredStorage.setStorageBool(position, data);
    }

    function setStorageAddress(bytes32 position, address data) public {
        return UnstructuredStorage.setStorageAddress(position, data);
    }

    function setStorageBytes32(bytes32 position, bytes32 data) public {
        return UnstructuredStorage.setStorageBytes32(position, data);
    }

    function setStorageUint256(bytes32 position, uint256 data) public {
        return UnstructuredStorage.setStorageUint256(position, data);
    }
}

contract ExposedUnstructuredStorageTest is Test {
    ExposedUnstructuredStorage public unstructedStorage;

    function setUp() public {
        unstructedStorage = new ExposedUnstructuredStorage();
    }

    function testGetStorageBoolUnitialized() public {
        bytes32 position = keccak256("FOO"); 
        assertEq(unstructedStorage.getStorageBool(position), false);
    }

    function testGetStorageBoolUnitializedFuzz(bytes32 position) public {
        assertEq(unstructedStorage.getStorageBool(position), false);
    }

    function testGetStorageAddressUnitialized() public {
        bytes32 position = keccak256("FOO");
        assertEq(unstructedStorage.getStorageAddress(position), address(0));
    }

    function testGetStorageAddressUnitializedFuzz(bytes32 position ) public {
        assertEq(unstructedStorage.getStorageAddress(position), address(0));
    }

    function testGetStorageBytes32Unitialized() public {
        bytes32 position = keccak256("FOO");
        bytes32 data;
        assertEq(unstructedStorage.getStorageBytes32(position), data);
    }

    function testGetStorageBytes32UnitializedFuzz(bytes32 position) public {
        bytes32 data;
        assertEq(unstructedStorage.getStorageBytes32(position), data);
    }

    function testGetStorageUint256Unitialized() public {
        bytes32 position = keccak256("FOO");
        uint256 data;
        assertEq(unstructedStorage.getStorageUint256(position), data);
    }

    function testGetStorageUint256UnitializedFuzz(bytes32 position) public {
        uint256 data;
        assertEq(unstructedStorage.getStorageUint256(position), data);
    }

    function testSetStorageBool() public {
        bytes32 position = keccak256("FOO");
        assertEq(unstructedStorage.getStorageBool(position), false);

        unstructedStorage.setStorageBool(position, true);
        assertEq(unstructedStorage.getStorageBool(position), true);

        unstructedStorage.setStorageBool(position, false);
        assertEq(unstructedStorage.getStorageBool(position), false);
    }

    function testSetStorageAddress() public {
        bytes32 position = keccak256("FOO");
        address data = vm.addr(1);

        assertEq(unstructedStorage.getStorageAddress(position), address(0));
        unstructedStorage.setStorageAddress(position, data);
        assertEq(unstructedStorage.getStorageAddress(position), data);
    }

    function testSetStorageAddressFuzz(address data, bytes32 position) public {
        assertEq(unstructedStorage.getStorageAddress(position), address(0));
        unstructedStorage.setStorageAddress(position, data);
        assertEq(unstructedStorage.getStorageAddress(position), data);
    }

    function testSetStorageBytes32() public {
        bytes32 position = keccak256("FOO");
        bytes32 data = keccak256("BAR");
        bytes32 unintializedData;

        assertEq(unstructedStorage.getStorageBytes32(position), unintializedData);
        unstructedStorage.setStorageBytes32(position, data);
        assertEq(unstructedStorage.getStorageBytes32(position), data);
    }

    function testSetStorageBytes32Fuzz(bytes32 data, bytes32 position) public {
        bytes32 unintializedData;

        assertEq(unstructedStorage.getStorageBytes32(position), unintializedData);
        unstructedStorage.setStorageBytes32(position, data);
        assertEq(unstructedStorage.getStorageBytes32(position), data);
    }

    function testSetStorageUint256() public {
        bytes32 position = keccak256("FOO");
        uint256 data = 1;
        uint256 unintializedData;

        assertEq(unstructedStorage.getStorageUint256(position), unintializedData);
        unstructedStorage.setStorageUint256(position, data);
        assertEq(unstructedStorage.getStorageUint256(position), data);
    }

    function testSetStorageUint256Fuzz(uint256 data, bytes32 position) public {
        uint256 unintializedData;

        assertEq(unstructedStorage.getStorageUint256(position), unintializedData);
        unstructedStorage.setStorageUint256(position, data);
        assertEq(unstructedStorage.getStorageUint256(position), data);
    }

}