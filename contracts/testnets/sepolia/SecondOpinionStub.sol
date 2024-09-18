// SPDX-License-Identifier: UNLICENSED
// for testing purposes only

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {ISecondOpinionOracle} from "../../0.8.9/interfaces/ISecondOpinionOracle.sol";

struct StubReportData {
    uint256 refSlot;
    bool success;
    uint256 clBalanceGwei;
    uint256 withdrawalVaultBalanceWei;
}

contract SecondOpinionStub is ISecondOpinionOracle {

    mapping(uint256 => StubReportData) reports;

    /// @notice Returns second opinion report for the given reference slot
    /// @param refSlot is a reference slot to return report for
    /// @return success shows whether the report was successfully generated
    /// @return clBalanceGwei is a balance of the consensus layer in Gwei for the ref slot
    /// @return withdrawalVaultBalanceWei is a balance of the withdrawal vault in Wei for the ref slot
    /// @return totalDepositedValidators is a total number of validators deposited with Lido
    /// @return totalExitedValidators is a total number of Lido validators in the EXITED state
    function getReport(uint256 refSlot)
        external
        view
        returns (
            bool success,
            uint256 clBalanceGwei,
            uint256 withdrawalVaultBalanceWei,
            uint256 totalDepositedValidators,
            uint256 totalExitedValidators
        ) {
            StubReportData memory report = reports[refSlot];
            if (report.refSlot == refSlot) {
                return (report.success, report.clBalanceGwei, report.withdrawalVaultBalanceWei, 0, 0);
            }
            return (false, 0, 0, 0, 0);
        }

        function addReportStub(StubReportData memory data) external {
            reports[data.refSlot] = data;
        }
}
