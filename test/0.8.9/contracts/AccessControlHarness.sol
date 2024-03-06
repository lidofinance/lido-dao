// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {AccessControl} from "contracts/0.8.9/utils/access/AccessControl.sol";

contract AccessControlHarness is AccessControl {

  bytes32 public constant TEST_ADMIN_ROLE = keccak256("TEST_ADMIN_ROLE");

  bytes32 public constant TEST_ROLE = keccak256("TEST_ROLE");

  constructor() {
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
  }

  function modifierOnlyRole(bytes32 role) external view onlyRole(role) {}

  function exposedSetupAdminRole(bytes32 role, bytes32 adminRole) external {
    _setRoleAdmin(role, adminRole);
  }
}
