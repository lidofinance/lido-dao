// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { Math } from "../lib/Math.sol";
import { UnstructuredStorage } from "../lib/UnstructuredStorage.sol";
import { AllowanceBasedRateLimit as RateLimit } from "../lib/AllowanceBasedRateLimit.sol";

import { BaseOracle } from "./BaseOracle.sol";


contract ValidatorsExitBusOracle is BaseOracle {
    using RateLimit for RateLimit.State;
    using UnstructuredStorage for bytes32;
    using SafeCast for uint256;

    error AdminCannotBeZero();
    error SenderNotAllowed();
    error UnsupportedRequestsDataFormat(uint256 format);
    error InvalidRequestsData();
    error InvalidRequestsDataLength();
    error UnexpectedRequestsDataLength();
    error InvalidRequestsDataSortOrder();
    error ArgumentOutOfBounds();

    event DataBoundariesSet(
        uint256 indexed refSlot,
        uint256 maxExitRequestsPerReport,
        uint256 maxExitRequestsListLength,
        uint256 exitRequestsRateLimitWindowSizeSlots,
        uint256 exitRequestsRateLimitMaxThroughputE18
    );

    event ValidatorExitRequest(
        uint256 indexed stakingModuleId,
        uint256 indexed nodeOperatorId,
        uint256 indexed validatorIndex,
        bytes validatorPubkey
    );

    event WarnDataIncompleteProcessing(
        uint256 indexed refSlot,
        uint256 requestsProcessed,
        uint256 requestsCount
    );

    struct DataBoundaries {
        uint64 maxRequestsPerReport;
        uint64 maxRequestsListLength;
    }

    struct DataProcessingState {
        uint256 lastProcessedItemWithoutPubkey;
        uint64 refSlot;
        uint64 requestsCount;
        uint64 requestsProcessed;
        uint16 dataFormat;
    }

    /// @notice An ACL role granting the permission to submit the data for a committee report.
    bytes32 public constant SUBMIT_DATA_ROLE = keccak256("SUBMIT_DATA_ROLE");

    /// @notice An ACL role granting the permission to set report data safety boundaries.
    bytes32 public constant MANAGE_DATA_BOUNDARIES_ROLE = keccak256("MANAGE_DATA_BOUNDARIES_ROLE");


    /// @dev Storage slot: uint256 totalRequestsProcessed
    bytes32 internal constant TOTAL_REQUESTS_PROCESSED_POSITION =
        keccak256("lido.ValidatorsExitBusOracle.totalRequestsProcessed");

    /// @dev Storage slot: mapping(uint256 => uint256) lastRequestedValidatorIndices
    /// A mapping from the (moduleId, nodeOpId) packed key to the last requested validator index.
    bytes32 internal constant LAST_REQUESTED_VALIDATOR_INDICES_POSITION =
        keccak256("lido.ValidatorsExitBusOracle.lastRequestedValidatorIndices");

    /// @dev Storage slot: RateLimit.State rateLimit
    bytes32 internal constant RATE_LIMIT_POSITION =
        keccak256("lido.ValidatorsExitBusOracle.rateLimit");

    /// @dev Storage slot: DataBoundaries dataBoundaries
    bytes32 internal constant DATA_BOUNDARIES_POSITION =
        keccak256("lido.ValidatorsExitBusOracle.dataBoundaries");

    /// @dev Storage slot: DataProcessingState dataProcessingState
    bytes32 internal constant DATA_PROCESSING_STATE_POSITION =
        keccak256("lido.ValidatorsExitBusOracle.dataProcessingState");

    ///
    /// Initialization & admin functions
    ///

    constructor(uint256 secondsPerSlot) BaseOracle(secondsPerSlot) {}

    function initialize(
        address admin,
        address consensusContract,
        uint256 consensusVersion,
        uint256 lastProcessingRefSlot,
        uint256 maxExitRequestsPerReport,
        uint256 maxExitRequestsListLength,
        uint256 exitRequestsRateLimitWindowSizeSlots,
        uint256 exitRequestsRateLimitMaxThroughputE18
    ) external {
        if (admin == address(0)) revert AdminCannotBeZero();
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _initialize(consensusContract, consensusVersion, lastProcessingRefSlot);
        _setDataBoundaries(
            maxExitRequestsPerReport,
            maxExitRequestsListLength,
            exitRequestsRateLimitWindowSizeSlots,
            exitRequestsRateLimitMaxThroughputE18
        );
    }

    /// @notice Sets data safety boundaries.
    ///
    /// @param maxExitRequestsPerReport The maximum number of exit requests per report.
    ///
    /// @param maxExitRequestsListLength The maximum number of exit requests in a list
    ///        for DATA_FORMAT_LIST data format.
    ///
    /// @param exitRequestsRateLimitMaxThroughputE18 The maximum number of exit requests
    ///        in a sliding window lasting `exitRequestsRateLimitWindowSizeSlots` slots,
    ///        multiplied by 10**18. This sets the maximum throughput after a period of
    ///        low number of exit requests. If requests continue after the max throughput
    ///        is exhausted, the throughput will be limited by approx. half of the max
    ///        throughput until the new period of low number of exit requests occur.
    ///
    /// @param exitRequestsRateLimitWindowSizeSlots Size of the rate limiting window.
    ///        See `exitRequestsRateLimitMaxThroughputE18`.
    ///
    function setDataBoundaries(
        uint256 maxExitRequestsPerReport,
        uint256 maxExitRequestsListLength,
        uint256 exitRequestsRateLimitWindowSizeSlots,
        uint256 exitRequestsRateLimitMaxThroughputE18
    )
        external
        onlyRole(MANAGE_DATA_BOUNDARIES_ROLE)
    {
        _setDataBoundaries(
            maxExitRequestsPerReport,
            maxExitRequestsListLength,
            exitRequestsRateLimitWindowSizeSlots,
            exitRequestsRateLimitMaxThroughputE18
        );
    }

    /// @notice Returns the current data safety boundaries. See `setDataBoundaries`.
    ///
    function getDataBoundaries() external view returns (
        uint256 maxExitRequestsPerReport,
        uint256 maxExitRequestsListLength,
        uint256 exitRequestsRateLimitWindowSizeSlots,
        uint256 exitRequestsRateLimitMaxThroughputE18
    ) {
        DataBoundaries memory boundaries = _storageDataBoundaries().value;
        maxExitRequestsPerReport = boundaries.maxRequestsPerReport;
        maxExitRequestsListLength = boundaries.maxRequestsListLength;
        (exitRequestsRateLimitMaxThroughputE18, exitRequestsRateLimitWindowSizeSlots) =
            RateLimit.load(RATE_LIMIT_POSITION).getThroughputConfig();
    }

    ///
    /// Data provider interface
    ///

    struct ReportData {
        ///
        /// Oracle consensus info
        ///

        /// @dev Version of the oracle consensus rules. Current version expected
        /// by the oracle can be obtained by calling getConsensusVersion().
        uint256 consensusVersion;

        /// @dev Reference slot for which the report was calculated. If the slot
        /// contains a block, the state being reported should include all state
        /// changes resulting from that block. The epoch containing the slot
        /// should be finalized prior to calculating the report.
        uint256 refSlot;

        ///
        /// Requests data
        ///

        /// @dev Total number of validator exit requests in this report. Must not be
        /// greater than the value returned from getMaxExitRequestsForCurrentFrame()
        /// called within the same reporting frame.
        uint256 requestsCount;

        /// @dev Format of the validator exit requests data. Currently, only the
        /// DATA_FORMAT_LIST=0 is supported.
        uint256 dataFormat;

        /// @dev Validator exit requests data. Can differ based on the data format,
        /// see the constant defining a specific data format below for more info.
        bytes data;
    }

    /// @notice The list format of the validator exit requests data. Used when all
    /// requests fit into a single transaction.
    ///
    /// Each validator exit request is described by the following 64-byte array:
    ///
    /// MSB <------------------------------------------------------- LSB
    /// |  3 bytes   |  5 bytes   |     8 bytes      |    48 bytes     |
    /// |  moduleId  |  nodeOpId  |  validatorIndex  | validatorPubkey |
    ///
    /// All requests are tightly packed into a byte array where requests follow
    /// one another without any separator or padding, and passed to the `data`
    /// field of the report structure.
    ///
    /// Requests must be sorted in the ascending order by the following compound
    /// key: (moduleId, nodeOpId, validatorIndex).
    ///
    uint256 public constant DATA_FORMAT_LIST = 0;

    /// @notice Submits report data for processing.
    ///
    /// @param data The data. See the `ReportData` structure's docs for details.
    /// @param contractVersion Expected version of the oracle contract.
    ///
    /// Reverts if:
    /// - The caller is not a member of the oracle committee and doesn't possess the
    ///   SUBMIT_DATA_ROLE.
    /// - The provided contract version is different from the current one.
    /// - The provided consensus version is different from the expected one.
    /// - The provided reference slot differs from the current consensus frame's one.
    /// - The processing deadline for the current consensus frame is missed.
    /// - The keccak256 hash of the ABI-encoded data is different from the last hash
    ///   provided by the hash consensus contract.
    /// - The provided data doesn't meet safety checks and boundaries.
    ///
    function submitReportData(ReportData calldata data, uint256 contractVersion) external {
        _checkMsgSenderIsAllowedToSubmitData();
        _checkContractVersion(contractVersion);
        // it's a waste of gas to copy the whole calldata into mem but seems there's no way around
        _checkConsensusData(data.refSlot, data.consensusVersion, keccak256(abi.encode(data)));
        _startProcessing();
        _handleConsensusReportData(data);
    }

    /// @notice Returns maximum number of validator exit requests that can be
    /// submitted in the report for the current frame, accounting for both
    /// the rate limit and the absolute limit per report.
    ///
    function getMaxExitRequestsForCurrentFrame() external view returns (uint256) {
        return Math.min(
            _storageDataBoundaries().value.maxRequestsPerReport,
            RateLimit.load(RATE_LIMIT_POSITION).calculateLimitAt(_getCurrentRefSlot()) / 10**18
        );
    }

    /// @notice Returns the total number of validator exit requests ever processed
    /// across all received reports.
    ///
    function getTotalRequestsProcessed() external view returns (uint256) {
        return TOTAL_REQUESTS_PROCESSED_POSITION.getStorageUint256();
    }

    /// @notice Returns the latest validator index that was requested to exit
    /// for the given `nodeOperatorId` in the given `moduleId`.
    ///
    function getLastRequestedValidatorIndex(uint256 moduleId, uint256 nodeOpId)
        external view returns (uint256)
    {
        if (moduleId > type(uint24).max) revert ArgumentOutOfBounds();
        if (nodeOpId > type(uint40).max) revert ArgumentOutOfBounds();
        uint256 nodeOpKey = _computeNodeOpKey(moduleId, nodeOpId);
        return _storageLastRequestedValidatorIndices()[nodeOpKey];
    }

    /// @notice Returns processing state for the current consensus report.
    ///
    function getDataProcessingState() external view returns (
        bool processingStarted,
        uint256 requestsCount,
        uint256 requestsProcessed,
        uint256 dataFormat
    ) {
        DataProcessingState memory state = _storageDataProcessingState().value;
        uint256 processingRefSlot = LAST_PROCESSING_REF_SLOT_POSITION.getStorageUint256();
        processingStarted = state.refSlot != 0 && state.refSlot == processingRefSlot;
        if (processingStarted) {
            requestsCount = state.requestsCount;
            requestsProcessed = state.requestsProcessed;
            dataFormat = state.dataFormat;
        }
    }

    ///
    /// Implementation & helpers
    ///

    function _setDataBoundaries(
        uint256 maxRequestsPerReport,
        uint256 maxRequestsListLength,
        uint256 rateLimitWindowSlots,
        uint256 rateLimitMaxThroughputE18
    ) internal {
        uint256 currentRefSlot = _getCurrentRefSlot();

        _storageDataBoundaries().value = DataBoundaries({
            maxRequestsPerReport: maxRequestsPerReport.toUint64(),
            maxRequestsListLength: maxRequestsListLength.toUint64()
        });

        RateLimit
            .load(RATE_LIMIT_POSITION)
            .configureThroughput(currentRefSlot, rateLimitWindowSlots, rateLimitMaxThroughputE18)
            .store(RATE_LIMIT_POSITION);

        emit DataBoundariesSet(
            currentRefSlot,
            maxRequestsPerReport,
            maxRequestsListLength,
            rateLimitWindowSlots,
            rateLimitMaxThroughputE18
        );
    }

    function _handleConsensusReport(
        ConsensusReport memory /* report */,
        uint256 /* prevSubmittedRefSlot */,
        uint256 prevProcessingRefSlot
    ) internal override {
        DataProcessingState memory state = _storageDataProcessingState().value;
        if (state.refSlot == prevProcessingRefSlot && state.requestsProcessed < state.requestsCount) {
            emit WarnDataIncompleteProcessing(
                prevProcessingRefSlot,
                state.requestsProcessed,
                state.requestsCount
            );
        }
    }

    function _checkMsgSenderIsAllowedToSubmitData() internal view {
        address sender = _msgSender();
        if (!hasRole(SUBMIT_DATA_ROLE, sender) && !_isConsensusMember(sender)) {
            revert SenderNotAllowed();
        }
    }

    function _handleConsensusReportData(ReportData calldata data) internal {
        if (data.dataFormat != DATA_FORMAT_LIST) {
            revert UnsupportedRequestsDataFormat(data.dataFormat);
        }

        if (data.data.length % 64 != 0) {
            revert InvalidRequestsDataLength();
        }

        if (data.data.length / 64 != data.requestsCount) {
            revert UnexpectedRequestsDataLength();
        }

        uint256 lastProcessedItemWithoutPubkey = _processExitRequestsList(data.data);

        _storageDataProcessingState().value = DataProcessingState({
            lastProcessedItemWithoutPubkey: lastProcessedItemWithoutPubkey,
            refSlot: data.refSlot.toUint64(),
            requestsCount: data.requestsCount.toUint64(),
            requestsProcessed: data.requestsCount.toUint64(),
            dataFormat: uint16(DATA_FORMAT_LIST)
        });

        if (data.requestsCount == 0) {
            return;
        }

        RateLimit
            .load(RATE_LIMIT_POSITION)
            .recordUsageAt(data.refSlot, data.requestsCount * 10**18)
            .store(RATE_LIMIT_POSITION);

        TOTAL_REQUESTS_PROCESSED_POSITION.setStorageUint256(
            TOTAL_REQUESTS_PROCESSED_POSITION.getStorageUint256() + data.requestsCount
        );
    }

    function _processExitRequestsList(bytes calldata data) internal returns (uint256) {
        uint256 offset;
        uint256 offsetPastEnd;
        assembly {
            offset := data.offset
            offsetPastEnd := add(offset, data.length)
        }

        mapping(uint256 => uint256) storage _lastReqValidatorIndices =
            _storageLastRequestedValidatorIndices();

        uint256 lastDataWithoutPubkey = 0;
        uint256 dataWithoutPubkey;
        uint256 lastNodeOpKey = 0;
        uint256 lastValIndex;
        bytes calldata pubkey;

        assembly {
            pubkey.length := 48
        }

        while (offset < offsetPastEnd) {
            assembly {
                // 16 most significant bytes are taken by module id, node op id, and val index
                dataWithoutPubkey := shr(128, calldataload(offset))
                // the next 48 bytes are taken by the pubkey
                pubkey.offset := add(offset, 16)
                // totalling to 64 bytes
                offset := add(offset, 64)
            }
            //                              dataWithoutPubkey
            // MSB <---------------------------------------------------------------------- LSB
            // | 128 bits: zeros | 24 bits: moduleId | 40 bits: nodeOpId | 64 bits: valIndex |
            //
            if (dataWithoutPubkey <= lastDataWithoutPubkey) {
                revert InvalidRequestsDataSortOrder();
            }

            uint256 valIndex = uint64(dataWithoutPubkey);
            uint256 nodeOpId = uint40(dataWithoutPubkey >> 64);
            uint256 moduleId = uint24(dataWithoutPubkey >> (64 + 40));

            if (moduleId == 0) {
                revert InvalidRequestsData();
            }

            uint256 nodeOpKey = _computeNodeOpKey(moduleId, nodeOpId);
            if (nodeOpKey != lastNodeOpKey) {
                if (lastNodeOpKey != 0) {
                    _lastReqValidatorIndices[lastNodeOpKey] = lastValIndex;
                }
                lastNodeOpKey = nodeOpKey;
            }

            lastValIndex = valIndex;
            lastDataWithoutPubkey = dataWithoutPubkey;

            emit ValidatorExitRequest(moduleId, nodeOpId, valIndex, pubkey);
        }

        if (lastNodeOpKey != 0) {
            _lastReqValidatorIndices[lastNodeOpKey] = lastValIndex;
        }

        return lastDataWithoutPubkey;
    }

    function _computeNodeOpKey(uint256 moduleId, uint256 nodeOpId) internal pure returns (uint256) {
        return (moduleId << 40) | nodeOpId;
    }

    ///
    /// Storage helpers
    ///

    function _storageLastRequestedValidatorIndices() internal pure returns (
        mapping(uint256 => uint256) storage r
    ) {
        bytes32 position = LAST_REQUESTED_VALIDATOR_INDICES_POSITION;
        assembly { r.slot := position }
    }

    struct StorageDataBoundaries {
        DataBoundaries value;
    }

    function _storageDataBoundaries() internal pure returns (StorageDataBoundaries storage r) {
        bytes32 position = DATA_BOUNDARIES_POSITION;
        assembly { r.slot := position }
    }

    struct StorageDataProcessingState {
        DataProcessingState value;
    }

    function _storageDataProcessingState() internal pure returns (
        StorageDataProcessingState storage r
    ) {
        bytes32 position = DATA_PROCESSING_STATE_POSITION;
        assembly { r.slot := position }
    }
}
