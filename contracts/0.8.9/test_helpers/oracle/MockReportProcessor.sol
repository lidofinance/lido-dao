// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { IReportAsyncProcessor } from "../../oracle/HashConsensus.sol";

contract MockReportProcessor is IReportAsyncProcessor {
    uint256 internal _consensusVersion;

    struct StartProcessingLastCall {
        bytes32 report;
        uint256 refSlot;
        uint256 deadline;
        uint256 callCount;
    }

    StartProcessingLastCall internal _startProcessingLastCall;
    uint256 internal _lastProcessedRefSlot;

    constructor(uint256 consensusVersion) {
        _consensusVersion = consensusVersion;
    }

    function setConsensusVersion(uint256 consensusVersion) external {
        _consensusVersion = consensusVersion;
    }

    function setLastProcessedRefSlot(uint256 refSlot) external {
        _lastProcessedRefSlot = refSlot;
    }

    function getLastCall_startProcessing() external view returns (StartProcessingLastCall memory) {
        return _startProcessingLastCall;
    }

    function markLastReportProcessed() external {
        _lastProcessedRefSlot = _startProcessingLastCall.refSlot;
    }

    ///
    /// IReportAsyncProcessor
    ///

    function getConsensusVersion() external view returns (uint256) {
        return _consensusVersion;
    }

    function startProcessing(bytes32 report, uint256 refSlot, uint256 deadline) external {
        _startProcessingLastCall.report = report;
        _startProcessingLastCall.refSlot = refSlot;
        _startProcessingLastCall.deadline = deadline;
        ++_startProcessingLastCall.callCount;
    }

    function getLastProcessedRefSlot() external view returns (uint256) {
        return _lastProcessedRefSlot;
    }
}
