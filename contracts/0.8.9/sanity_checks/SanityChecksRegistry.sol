// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {Versioned} from "../utils/Versioned.sol";
import {SanityChecksManagement} from "./SanityChecksManagement.sol";
import {AccountingOracleReportSanityChecks} from "./AccountingOracleReportSanityChecks.sol";

contract SanityChecksRegistry is SanityChecksManagement, Versioned, AccountingOracleReportSanityChecks {
    constructor(
        address _lido,
        address _withdrawalVault,
        address _withdrawalQueue
    ) AccountingOracleReportSanityChecks(_lido, _withdrawalVault, _withdrawalQueue) {}

    function initialize(address _admin, address _limitsManager) external {
        _initializeContractVersionTo1();
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(LIMITS_MANAGER_ROLE, _limitsManager);
    }
}
