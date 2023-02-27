// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { IWithdrawalQueue } from "../../oracle/AccountingOracle.sol";

contract MockWithdrawalQueueForAccountingOracle is IWithdrawalQueue {
    struct OnPreRebaseCallData {
        uint256 callCount;
    }

    struct UpdateBunkerModeCallData {
        bool isBunkerMode;
        uint256 prevReportTimestamp;
        uint256 callCount;
    }

    UpdateBunkerModeCallData public lastCall__updateBunkerMode;
    OnPreRebaseCallData public lastCall__onPreRebase;

    function updateBunkerMode(bool isBunkerMode, uint256 prevReportTimestamp) external {
        lastCall__updateBunkerMode.isBunkerMode = isBunkerMode;
        lastCall__updateBunkerMode.prevReportTimestamp = prevReportTimestamp;
        ++lastCall__updateBunkerMode.callCount;
    }

    function onPreRebase() external {
        ++lastCall__onPreRebase.callCount;
    }
}
