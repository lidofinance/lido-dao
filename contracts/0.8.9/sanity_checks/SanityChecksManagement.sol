// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "../utils/access/AccessControlEnumerable.sol";

abstract contract SanityChecksManagement is AccessControlEnumerable {
    bytes32 public constant LIMITS_MANAGER_ROLE = keccak256("LIMITS_MANAGER_ROLE");

    modifier onlyLimitsManager() {
        _checkRole(LIMITS_MANAGER_ROLE, msg.sender);
        _;
    }
}
