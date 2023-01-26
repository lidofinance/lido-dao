// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


import { AccessControlEnumerable } from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";
import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { IReportAsyncProcessor } from "./HashConsensus.sol";

import { UnstructuredStorage } from "../lib/UnstructuredStorage.sol";
import { Versioned } from "../utils/Versioned.sol";


interface IConsensusContract {
    function getIsMember(address addr) external view returns (bool);
}


contract BaseOracle is IReportAsyncProcessor, AccessControlEnumerable, Versioned {
    using UnstructuredStorage for bytes32;
    using SafeCast for uint256;

    error AddressCannotBeZero();
    error AddressCannotBeSame();
    error VersionCannotBeSame();
    error OnlyConsensusContractCanStartProcessing();
    error ProcessedRefSlotMustIncrease(uint256 processedRefSlot, uint256 newRefSlot);
    error RefSlotCannotDecrease(uint256 processingRefSlot, uint256 newRefSlot);
    error ProcessingDeadlineMissed(uint256 deadline);
    error UnexpectedRefSlot(uint256 consensusRefSlot, uint256 dataRefSlot);
    error UnexpectedConsensusVersion(uint256 expectedVersion, uint256 receivedVersion);

    event ConsensusContractSet(address indexed addr, address indexed prevAddr);
    event ConsensusVersionSet(uint256 indexed version, uint256 indexed prevVersion);
    event ProcessingStarted(uint256 indexed refSlot, bytes32 hash, uint256 deadlineTime);
    event ProcessingFinished(uint256 indexed refSlot, bytes32 hash);

    struct ConsensusReport {
        bytes32 hash;
        uint64 refSlot;
        uint64 receptionTime;
        uint64 deadlineTime;
    }

    /// @notice An ACL role granting the permission to set the consensus
    /// contract address by calling setConsensusContract.
    bytes32 public constant MANAGE_CONSENSUS_CONTRACT_ROLE =
        keccak256("MANAGE_CONSENSUS_CONTRACT_ROLE");

    /// @notice An ACL role granting the permission to set the consensus
    /// version by calling setConsensusVersion.
    bytes32 public constant MANAGE_CONSENSUS_VERSION_ROLE =
        keccak256("MANAGE_CONSENSUS_VERSION_ROLE");


    bytes32 internal constant CONSENSUS_CONTRACT_POSITION =
        keccak256("lido.BaseOracle.consensusContract");

    bytes32 internal constant CONSENSUS_VERSION_POSITION =
        keccak256("lido.BaseOracle.consensusVersion");

    bytes32 internal constant LAST_PROCESSED_REF_SLOT_POSITION =
        keccak256("lido.BaseOracle.lastProcessedRefSlot");

    bytes32 internal constant PROCESSING_REPORT_POSITION =
        keccak256("lido.BaseOracle.processingReport");


    function _initialize(address consensusContract, uint256 consensusVersion) internal virtual {
        _initializeContractVersionTo1();

        if (consensusContract != address(0)) {
            _setConsensusContract(consensusContract);
        }

        _setConsensusVersion(consensusVersion);
    }

    ///
    /// Config
    ///

    /// @notice Returns the address of the HashConsensus contract.
    function getConsensusContract() external view returns (address) {
        return CONSENSUS_CONTRACT_POSITION.getStorageAddress();
    }

    function setConsensusContract(address addr) external onlyRole(MANAGE_CONSENSUS_CONTRACT_ROLE) {
        _setConsensusContract(addr);
    }

    /// @notice Returns the oracle consensus rules version expected by the oracle contract.
    function getConsensusVersion() external view returns (uint256) {
        return CONSENSUS_VERSION_POSITION.getStorageUint256();
    }

    function setConsensusVersion(uint256 version) external onlyRole(MANAGE_CONSENSUS_VERSION_ROLE) {
        _setConsensusVersion(version);
    }

    function _setConsensusVersion(uint256 version) internal {
        uint256 prevVersion = CONSENSUS_VERSION_POSITION.getStorageUint256();
        if (version == prevVersion) revert VersionCannotBeSame();
        CONSENSUS_VERSION_POSITION.setStorageUint256(version);
        emit ConsensusVersionSet(version, prevVersion);
    }

    function _setConsensusContract(address addr) internal {
        if (addr == address(0)) revert AddressCannotBeZero();
        address prevAddr = CONSENSUS_CONTRACT_POSITION.getStorageAddress();
        if (addr == prevAddr) revert AddressCannotBeSame();
        CONSENSUS_CONTRACT_POSITION.setStorageAddress(addr);
        emit ConsensusContractSet(addr, prevAddr);
    }

    ///
    /// Data provider interface
    ///

    /// @notice Returns the last consensus report hash and metadata.
    function getConsensusReport() external view returns (
        bytes32 hash,
        uint256 refSlot,
        uint256 receptionTime,
        uint256 deadlineTime,
        bool isProcessed
    ) {
        ConsensusReport memory report = _storageProcessingReport().value;
        uint256 processedRefSlot = LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256();
        return (
            report.hash,
            report.refSlot,
            report.receptionTime,
            report.deadlineTime,
            report.refSlot != 0 && report.refSlot == processedRefSlot
        );
    }

    ///
    /// Consensus contract interface
    ///

    function startProcessing(bytes32 reportHash, uint256 refSlot, uint256 deadline) external {
        if (_msgSender() != CONSENSUS_CONTRACT_POSITION.getStorageAddress()) {
            revert OnlyConsensusContractCanStartProcessing();
        }

        uint256 lastProcessedRefSlot = LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256();
        if (refSlot <= lastProcessedRefSlot) {
            revert ProcessedRefSlotMustIncrease(lastProcessedRefSlot, refSlot);
        }

        uint256 processingRefSlot = _storageProcessingReport().value.refSlot;
        if (refSlot < processingRefSlot) {
            revert RefSlotCannotDecrease(processingRefSlot, refSlot);
        }

        ConsensusReport memory report = ConsensusReport(
            reportHash,
            refSlot.toUint64(),
            uint64(_getTime()),
            deadline.toUint64());

        _storageProcessingReport().value = report;
        _startProcessing(report);

        emit ProcessingStarted(refSlot, report.hash, deadline);
    }

    /// @notice Returns the last reference slot for which the data was processed.
    function getLastProcessedRefSlot() external view returns (uint256) {
        return LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256();
    }

    ///
    /// Internal interface
    ///

    function _isConsensusMember(address addr) internal view returns (bool) {
        address consensus = CONSENSUS_CONTRACT_POSITION.getStorageAddress();
        return consensus != address(0) && IConsensusContract(consensus).getIsMember(addr);
    }

    function _startProcessing(ConsensusReport memory report) internal virtual {}

    function _checkConsensusData(uint256 refSlot, uint256 consensusVersion) internal view {
        _checkDeadline();

        uint256 consensusRefSlot = _storageProcessingReport().value.refSlot;
        if (refSlot != consensusRefSlot) {
            revert UnexpectedRefSlot(consensusRefSlot, refSlot);
        }

        uint256 expectedConsensusVersion = CONSENSUS_VERSION_POSITION.getStorageUint256();
        if (consensusVersion != expectedConsensusVersion) {
            revert UnexpectedConsensusVersion(expectedConsensusVersion, consensusVersion);
        }
    }

    function _finishProcessing() internal {
        _checkDeadline();
        ConsensusReport memory processingReport = _storageProcessingReport().value;
        LAST_PROCESSED_REF_SLOT_POSITION.setStorageUint256(processingReport.refSlot);
        emit ProcessingFinished(processingReport.refSlot, processingReport.hash);
    }

    function _checkDeadline() internal view {
        uint256 deadline = _storageProcessingReport().value.deadlineTime;
        if (_getTime() > deadline) revert ProcessingDeadlineMissed(deadline);
    }

    function _getTime() internal virtual view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }

    ///
    /// Storage
    ///

    struct StorageConsensusReport {
        ConsensusReport value;
    }

    function _storageProcessingReport() internal pure returns (StorageConsensusReport storage r) {
        bytes32 position = PROCESSING_REPORT_POSITION;
        assembly { r.slot := position }
    }
}
