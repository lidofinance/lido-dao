// SPDX-License-Identifier: MIT

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {AccessControlEnumerable} from "../../contracts/0.8.9/utils/access/AccessControlEnumerable.sol";

contract AccessControlEnumerableTest is AccessControlEnumerable {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev Storage slot: mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers
    bytes32 private constant ROLE_MEMBERS_POSITION = keccak256("openzeppelin.AccessControlEnumerable._roleMembers");

    function storageRoleMembers() internal pure returns (
        mapping(bytes32 => EnumerableSet.AddressSet) storage _roleMembers
    ) {
        bytes32 position = ROLE_MEMBERS_POSITION;
        assembly { _roleMembers.slot := position }
    }

    function contains(bytes32 role, address account) public view returns (bool) {
        return storageRoleMembers()[role].contains(account);
    }

    function indexOfMember(bytes32 role, address account) public view returns (uint256) {
        return storageRoleMembers()[role]._inner._indexes[bytes32(uint256(uint160(account)))];
    }

    function realValue(bytes32 role, uint256 index) public view returns (uint256) {
        return uint256(storageRoleMembers()[role]._inner._values[index]);
    }
}