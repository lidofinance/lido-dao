// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccountingOracle, ILido} from "../oracle/AccountingOracle.sol";


// TODO: remove and use ILido
interface ILidoTemporary {
    function handleOracleReport(
        // CL values
        uint256 _clValidators,
        uint256 _clBalance,
        // EL values
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        // decision
        uint256 _requestIdToFinalizeUpTo,
        uint256 _finalizationShareRate
    ) external returns (uint256, uint256);
}


contract AccountingOracleMock {
    address public immutable LIDO;
    uint256 public immutable SECONDS_PER_SLOT;

    uint256 internal _lastRefSlot;

    constructor(address lido, uint256 secondsPerSlot) {
        LIDO = lido;
        SECONDS_PER_SLOT = secondsPerSlot;
    }

    function submitReportData(
        AccountingOracle.ReportData calldata data,
        uint256 /* contractVersion */
    ) external {
        // TODO: remove the line below
        // solhint-disable-next-line
        uint256 slotsElapsed = data.refSlot - _lastRefSlot;
        _lastRefSlot = data.refSlot;

        // TODO: update to use the actual signature
        // ILido(LIDO).handleOracleReport(
        //     slotsElapsed * SECONDS_PER_SLOT,
        //     data.numValidators,
        //     data.clBalanceGwei * 1e9,
        //     data.withdrawalVaultBalance,
        //     data.elRewardsVaultBalance,
        //     data.lastFinalizableWithdrawalRequestId,
        //     data.simulatedShareRate,
        //     data.isBunkerMode
        // );

        ILidoTemporary(LIDO).handleOracleReport(
            data.numValidators,
            data.clBalanceGwei * 1e9,
            data.withdrawalVaultBalance,
            data.elRewardsVaultBalance,
            data.lastFinalizableWithdrawalRequestId,
            data.simulatedShareRate
        );
    }

    function getLastProcessingRefSlot() external view returns (uint256) {
        return _lastRefSlot;
    }
}
