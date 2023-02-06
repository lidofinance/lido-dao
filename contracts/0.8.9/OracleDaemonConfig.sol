// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

contract OracleDaemonConfig is AccessControlEnumerable {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant CONFIG_MANAGER_ROLE = keccak256("CONFIG_MANAGER_ROLE");

    mapping(bytes32 => bytes) private values;
    EnumerableSet.Bytes32Set private keyHashes;

    constructor(address _admin, address[] memory _configManagers) {
        if (_admin == address(0)) revert ErrorZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        for (uint256 i = 0; i < _configManagers.length; ) {
            if (_configManagers[i] == address(0)) revert ErrorZeroAddress();
            _grantRole(CONFIG_MANAGER_ROLE, _configManagers[i]);

            unchecked {
                ++i;
            }
        }
    }

    function set(string calldata _key, bytes calldata _value) external onlyRole(CONFIG_MANAGER_ROLE) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (keyHashes.contains(keyHash)) revert ErrorValueExists(_key);

        keyHashes.add(keyHash);
        values[keyHash] = _value;

        emit ConfigValueSet(keyHash, _key, _value);
    }

    function update(string calldata _key, bytes calldata _value) external onlyRole(CONFIG_MANAGER_ROLE) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);
        values[keyHash] = _value;

        emit ConfigValueUpdated(keyHash, _key, _value);
    }

    function unset(string calldata _key) external onlyRole(CONFIG_MANAGER_ROLE) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);

        keyHashes.remove(keyHash);
        delete values[keyHash];

        emit ConfigValueUnset(keyHash, _key);
    }

    function get(string calldata _key) external view returns (bytes memory) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);

        return values[keyHash];
    }

    function getList(string[] calldata _keys) external view returns (bytes[] memory) {
        bytes[] memory results = new bytes[](_keys.length);

        for (uint256 i = 0; i < _keys.length; ) {
            bytes32 hashToRetrieve = bytes32(keccak256(abi.encodePacked(_keys[i])));

            if (!keyHashes.contains(hashToRetrieve)) revert ErrorValueDoesntExist(_keys[i]);

            results[i] = values[hashToRetrieve];

            unchecked {
                ++i;
            }
        }

        return results;
    }

    error ErrorValueExists(string key);
    error ErrorValueDoesntExist(string key);
    error ErrorZeroAddress();

    event ConfigValueSet(bytes32 indexed keyHash, string key, bytes value);
    event ConfigValueUpdated(bytes32 indexed keyHash, string key, bytes value);
    event ConfigValueUnset(bytes32 indexed keyHash, string key);
}
