// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

struct Item {
    bytes32 keyHash;
    bytes value;
}

contract OracleDaemonConfig is AccessControlEnumerable {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant CONFIG_MANAGER_ROLE = keccak256("CONFIG_MANAGER_ROLE");

    mapping(bytes32 => bytes) private _values;
    EnumerableSet.Bytes32Set private _keyHashes;

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
        if (_keyHashes.contains(keyHash)) revert ErrorValueExists(_key);

        _keyHashes.add(keyHash);
        _values[keyHash] = _value;

        emit ConfigValueSet(keyHash, _key, _value);
    }

    function update(string calldata _key, bytes calldata _value) external onlyRole(CONFIG_MANAGER_ROLE) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!_keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);
        _values[keyHash] = _value;

        emit ConfigValueUpdated(keyHash, _key, _value);
    }

    function unset(string calldata _key) external onlyRole(CONFIG_MANAGER_ROLE) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!_keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);

        _keyHashes.remove(keyHash);
        delete _values[keyHash];

        emit ConfigValueUnset(keyHash, _key);
    }

    function get(string calldata _key) external view returns (Item memory value) {
        bytes32 keyHash = bytes32(keccak256(abi.encodePacked(_key)));
        if (!_keyHashes.contains(keyHash)) revert ErrorValueDoesntExist(_key);

        return Item({keyHash: keyHash, value: _values[keyHash]});
    }

    function values() external view returns (Item[] memory) {
        bytes32[] memory keys = _keyHashes.values();
        Item[] memory values = new Item[](keys.length);

        for (uint256 i = 0; i < keys.length; ) {
            values[i].keyHash = keys[i];
            values[i].value = _values[keys[i]];

            unchecked {
                ++i;
            }
        }

        return values;
    }

    error ErrorValueExists(string key);
    error ErrorValueDoesntExist(string key);
    error ErrorZeroAddress();

    event ConfigValueSet(bytes32 indexed keyHash, string key, bytes value);
    event ConfigValueUpdated(bytes32 indexed keyHash, string key, bytes value);
    event ConfigValueUnset(bytes32 indexed keyHash, string key);
}
