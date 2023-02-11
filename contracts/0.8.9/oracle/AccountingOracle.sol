// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { ILidoLocator } from "../../common/interfaces/ILidoLocator.sol";
import { UnstructuredStorage } from "../lib/UnstructuredStorage.sol";

import { BaseOracle, IConsensusContract } from "./BaseOracle.sol";


interface ILido {
    function handleOracleReport(
        uint256 currentReportTimestamp,
        uint256 secondsElapsedSinceLastReport,
        // CL values
        uint256 beaconValidators,
        uint256 beaconBalance,
        // EL values
        uint256 withdrawalVaultBalance,
        uint256 elRewardsVaultBalance,
        // decision
        uint256 requestIdToFinalizeUpTo,
        uint256 finalizationShareRate
    ) external;
}


interface ILegacyOracle {
    // only called before the migration

    function getBeaconSpec() external view returns (
        uint64 epochsPerFrame,
        uint64 slotsPerEpoch,
        uint64 secondsPerSlot,
        uint64 genesisTime
    );

    function getLastCompletedEpochId() external view returns (uint256);

    // only called after the migration

    function handleConsensusLayerReport(
        uint256 refSlot,
        uint256 clBalance,
        uint256 clValidators
    ) external;
}

interface IOracleReportSanityChecker {
    function checkExitedValidatorsRatePerDay(uint256 _exitedValidatorsCount) external view;
    function checkAccountingExtraDataListItemsCount(uint256 _extraDataListItemsCount) external view;
    function checkNodeOperatorsPerExtraDataItemCount(uint256 _itemIndex, uint256 _nodeOperatorsCount) external view;
}

interface IStakingRouter {
    function getExitedValidatorsCountAcrossAllModules() external view returns (uint256);

    function updateExitedValidatorsCountByStakingModule(
        uint256[] calldata moduleIds,
        uint256[] calldata exitedValidatorsCounts
    ) external;

    function reportStakingModuleExitedValidatorsCountByNodeOperator(
        uint256 stakingModuleId,
        bytes calldata nodeOperatorIds,
        bytes calldata exitedValidatorsCounts
    ) external;

    function reportStakingModuleStuckValidatorsCountByNodeOperator(
        uint256 stakingModuleId,
        bytes calldata nodeOperatorIds,
        bytes calldata stuckValidatorsCounts
    ) external;
}


interface IWithdrawalQueue {
    function updateBunkerMode(bool isBunkerMode, uint256 prevReportTimestamp) external;
}


contract AccountingOracle is BaseOracle {
    using UnstructuredStorage for bytes32;
    using SafeCast for uint256;

    error LidoLocatorCannotBeZero();
    error AdminCannotBeZero();
    error LegacyOracleCannotBeZero();
    error IncorrectOracleMigration(uint256 code);
    error SenderNotAllowed();
    error InvalidExitedValidatorsData();
    error NumExitedValidatorsCannotDecrease();
    error UnsupportedExtraDataFormat(uint256 format);
    error UnsupportedExtraDataType(uint256 itemIndex, uint256 dataType);
    error CannotSubmitExtraDataBeforeMainData();
    error ExtraDataAlreadyProcessed();
    error ExtraDataListOnlySupportsSingleTx();
    error UnexpectedExtraDataFormat(uint256 expectedFormat, uint256 receivedFormat);
    error UnexpectedExtraDataItemsCount(uint256 expectedCount, uint256 receivedCount);
    error UnexpectedExtraDataIndex(uint256 expectedIndex, uint256 receivedIndex);
    error InvalidExtraDataItem(uint256 itemIndex);
    error InvalidExtraDataSortOrder(uint256 itemIndex);

    event ExtraDataSubmitted(uint256 indexed refSlot, uint256 itemsProcessed, uint256 itemsCount);

    event WarnExtraDataIncompleteProcessing(
        uint256 indexed refSlot,
        uint256 processedItemsCount,
        uint256 itemsCount
    );

    struct ExtraDataProcessingState {
        uint64 refSlot;
        uint16 dataFormat;
        uint64 itemsCount;
        uint64 itemsProcessed;
        uint256 lastSortingKey;
        bytes32 dataHash;
    }

    /// @notice An ACL role granting the permission to submit the data for a committee report.
    bytes32 public constant SUBMIT_DATA_ROLE = keccak256("SUBMIT_DATA_ROLE");

    /// @dev Storage slot: ExtraDataProcessingState state
    bytes32 internal constant EXTRA_DATA_PROCESSING_STATE_POSITION =
        keccak256("lido.AccountingOracle.extraDataProcessingState");

    address public immutable LIDO;
    ILidoLocator public immutable LOCATOR;
    address public immutable LEGACY_ORACLE;

    ///
    /// Initialization & admin functions
    ///

    constructor(address lidoLocator, address lido, address legacyOracle, uint256 secondsPerSlot, uint256 genesisTime)
        BaseOracle(secondsPerSlot, genesisTime)
    {
        if (lidoLocator == address(0)) revert LidoLocatorCannotBeZero();
        if (legacyOracle == address(0)) revert LegacyOracleCannotBeZero();
        LOCATOR = ILidoLocator(lidoLocator);
        LIDO = lido;
        LEGACY_ORACLE = legacyOracle;
    }

    function initialize(
        address admin,
        address consensusContract,
        uint256 consensusVersion
    ) external {
        if (admin == address(0)) revert AdminCannotBeZero();

        uint256 lastProcessingRefSlot = _checkOracleMigration(LEGACY_ORACLE, consensusContract);
        _initialize(admin, consensusContract, consensusVersion, lastProcessingRefSlot);
    }

    function initializeWithoutMigration(
        address admin,
        address consensusContract,
        uint256 consensusVersion,
        uint256 lastProcessingRefSlot
    ) external {
        if (admin == address(0)) revert AdminCannotBeZero();

        _initialize(admin, consensusContract, consensusVersion, lastProcessingRefSlot);
    }

    function _initialize(
        address admin,
        address consensusContract,
        uint256 consensusVersion,
        uint256 lastProcessingRefSlot
    ) internal {
        _setupRole(DEFAULT_ADMIN_ROLE, admin);

        BaseOracle._initialize(consensusContract, consensusVersion, lastProcessingRefSlot);
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
        /// CL values
        ///

        /// @dev The number of validators on consensus layer that were ever deposited
        /// via Lido as observed at the reference slot.
        uint256 numValidators;

        /// @dev Cumulative balance of all Lido validators on the consensus layer
        /// as observed at the reference slot.
        uint256 clBalanceGwei;

        /// @dev Ids of staking modules that have more exited validators than the number
        /// stored in the respective staking module contract as observed at the reference
        /// slot.
        uint256[] stakingModuleIdsWithNewlyExitedValidators;

        /// @dev Number of ever exited validators for each of the staking modules from
        /// the stakingModuleIdsWithNewlyExitedValidators array as observed at the
        /// reference slot.
        uint256[] numExitedValidatorsByStakingModule;

        ///
        /// EL values
        ///

        /// @dev The ETH balance of the Lido withdrawal vault as observed at the reference slot.
        uint256 withdrawalVaultBalance;

        /// @dev The ETH balance of the Lido execution layer rewards vault as observed
        /// at the reference slot.
        uint256 elRewardsVaultBalance;

        ///
        /// Decision
        ///

        /// @dev The id of the last withdrawal request that should be finalized as the result
        /// of applying this oracle report. The zero value means that no requests should be
        /// finalized.
        uint256 lastWithdrawalRequestIdToFinalize;

        /// @dev The share/ETH rate with the 10^27 precision (i.e. the price of one stETH share
        /// in ETH where one ETH is denominated as 10^27) used for finalizing withdrawal requests
        /// up to (and including) the one passed in the lastWithdrawalRequestIdToFinalize field.
        /// Must be set to zero if lastWithdrawalRequestIdToFinalize is zero.
        uint256 finalizationShareRate;

        /// @dev Whether, based on the state observed at the reference slot, the protocol should
        /// be in the bunker mode.
        bool isBunkerMode;

        ///
        /// Extra data — the oracle information that can be processed asynchronously in chunks
        /// after the main data is processed. The oracle doesn't enforce that extra data attached
        /// to some data report is processed in full before the processing deadline expires or a
        /// new data report starts being processed, but enforces that no processing of extra data
        /// for a report is possible after its processing deadline passes or a new data report
        /// arrives.
        ///
        /// Extra data is an array of items, each item being encoded as follows:
        ///
        ///    3 bytes    2 bytes      X bytes
        /// | itemIndex | itemType | itemPayload |
        ///
        /// itemIndex is a 0-based index into the extra data array;
        /// itemType is the type of extra data item;
        /// itemPayload is the item's data which interpretation depends on the item's type.
        ///
        /// Items should be sorted ascendingly by the (itemType, ...itemSortingKey) compound key
        /// where `itemSortingKey` calculation depends on the item's type (see below).
        ///
        /// ----------------------------------------------------------------------------------------
        ///
        /// itemType=0 (EXTRA_DATA_TYPE_STUCK_VALIDATORS): stuck validators by node operators.
        /// itemPayload format:
        ///
        /// | 3 bytes  |   8 bytes    |  nodeOpsCount * 8 bytes  |  nodeOpsCount * 16 bytes  |
        /// | moduleId | nodeOpsCount |      nodeOperatorIds     |   stuckValidatorsCounts   |
        ///
        /// moduleId is the staking module for which exited keys counts are being reported.
        ///
        /// nodeOperatorIds contains an array of ids of node operators that have total stuck
        /// validators counts changed compared to the staking module smart contract storage as
        /// observed at the reference slot. Each id is a 8-byte uint, ids are packed tightly.
        ///
        /// nodeOpsCount contains the number of node operator ids contained in the nodeOperatorIds
        /// array. Thus, nodeOpsCount = byteLength(nodeOperatorIds) / 8.
        ///
        /// stuckValidatorsCounts contains an array of stuck validators total counts, as observed at
        /// the reference slot, for the node operators from the nodeOperatorIds array, in the same
        /// order. Each count is a 16-byte uint, counts are packed tightly. Thus,
        /// byteLength(stuckValidatorsCounts) = nodeOpsCount * 16.
        ///
        /// nodeOpsCount must not be greater than maxAccountingExtraDataListItemsCount specified
        /// in OracleReportSanityChecker contract. If a staking module has more node operators
        /// with total stuck validators counts changed compared to the staking module smart contract
        /// storage (as observed at the reference slot), reporting for that module should be split
        /// into multiple items.
        ///
        /// Item sorting key is a compound key consisting of the module id and the first reported
        /// node operator's id:
        ///
        /// itemSortingKey = (moduleId, nodeOperatorIds[0:8])
        ///
        /// ----------------------------------------------------------------------------------------
        ///
        /// itemType=1 (EXTRA_DATA_TYPE_EXITED_VALIDATORS): exited validators by node operators.
        ///
        /// The payload format is exactly the same as for itemType=EXTRA_DATA_TYPE_STUCK_VALIDATORS,
        /// except that, instead of stuck validators counts, exited validators counts are reported.
        /// The `itemSortingKey` is calculated identically.
        ///
        /// ----------------------------------------------------------------------------------------
        ///
        /// The oracle daemon should report exited/stuck validators counts ONLY for those
        /// (moduleId, nodeOperatorId) pairs that contain outdated counts in the staking
        /// module smart contract as observed at the reference slot.
        ///
        /// Extra data array can be passed in different formats, see below.
        ///

        /// @dev Format of the extra data. Currently, only the EXTRA_DATA_FORMAT_LIST=0 is
        /// supported. See the constant defining a specific extra data format for more info.
        uint256 extraDataFormat;

        /// @dev Hash of the extra data. See the constant defining a specific extra data
        /// format for the info on how to calculate the hash.
        bytes32 extraDataHash;

        /// @dev Number of the extra data items.
        uint256 extraDataItemsCount;
    }

    uint256 public constant EXTRA_DATA_TYPE_STUCK_VALIDATORS = 1;
    uint256 public constant EXTRA_DATA_TYPE_EXITED_VALIDATORS = 2;

    /// @notice The list format for the extra data array. Used when all extra data processing
    /// fits into a single transaction.
    ///
    /// Extra data is passed within a single transaction as a bytearray containing all data items
    /// packed tightly.
    ///
    /// Hash is a keccak256 hash calculated over the bytearray items. The Solidity equivalent of
    /// the hash calculation code would be `keccak256(array)`, where `array` has the `bytes` type.
    ///
    uint256 public constant EXTRA_DATA_FORMAT_LIST = 1;

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
    /// - The provided data doesn't meet safety checks.
    ///
    function submitReportData(ReportData calldata data, uint256 contractVersion) external {
        _checkMsgSenderIsAllowedToSubmitData();
        _checkContractVersion(contractVersion);
        _checkConsensusData(data.refSlot, data.consensusVersion, keccak256(abi.encode(data)));
        uint256 prevRefSlot = _startProcessing();
        _handleConsensusReportData(data, prevRefSlot);
    }

    /// @notice Submits report extra data in the EXTRA_DATA_FORMAT_LIST format for processing.
    ///
    /// @param items The extra data items list. See docs for the `EXTRA_DATA_FORMAT_LIST`
    ///              constant for details.
    ///
    function submitReportExtraDataList(bytes calldata items) external {
        _submitReportExtraDataList(items);
    }

    struct ProcessingState {
        /// @notice Reference slot for the current reporting frame.
        uint256 currentFrameRefSlot;
        /// @notice The last time at which a data can be submitted for the current reporting frame.
        uint256 processingDeadlineTime;
        /// @notice Hash of the main report data. Zero bytes if consensus on the hash hasn't been
        /// reached yet for the current reporting frame.
        bytes32 mainDataHash;
        /// @notice Whether main report data for the for the current reporting frame has been
        /// already submitted.
        bool mainDataSubmitted;
        /// @notice Hash of the extra report data. Zero bytes if consensus on the main data hash
        /// hasn't been reached yet, or if the main report data hasn't been submitted yet, for the
        /// current reporting frame. Also zero bytes if the current reporting frame's data doesn't
        /// contain any extra data.
        bytes32 extraDataHash;
        /// @notice Format of the extra report data for the current reporting frame.
        uint256 extraDataFormat;
        /// @notice Total number of extra report data items for the current reporting frame.
        uint256 extraDataItemsCount;
        /// @notice How many extra report data items are already submitted for the current
        /// reporting frame.
        uint256 extraDataItemsSubmitted;
    }

    /// @notice Returns data processing state for the current reporting frame.
    /// @return result See the docs for the `ProcessingState` struct.
    ///
    function getProcessingState() external view returns (ProcessingState memory result) {
        ConsensusReport memory report = _storageConsensusReport().value;
        result.currentFrameRefSlot = _getCurrentRefSlot();

        if (result.currentFrameRefSlot != report.refSlot) {
            return result;
        }

        result.processingDeadlineTime = report.processingDeadlineTime;
        result.mainDataHash = report.hash;

        uint256 processingRefSlot = LAST_PROCESSING_REF_SLOT_POSITION.getStorageUint256();
        result.mainDataSubmitted = report.hash != bytes32(0) && report.refSlot == processingRefSlot;
        if (!result.mainDataSubmitted) {
            return result;
        }

        ExtraDataProcessingState memory extraState = _storageExtraDataProcessingState().value;
        if (extraState.dataHash == bytes32(0) || extraState.refSlot != processingRefSlot) {
            return result;
        }

        result.extraDataHash = extraState.dataHash;
        result.extraDataFormat = extraState.dataFormat;
        result.extraDataItemsCount = extraState.itemsCount;
        result.extraDataItemsSubmitted = extraState.itemsProcessed;
    }

    ///
    /// Implementation & helpers
    ///

    /// @dev Returns last processed reference slot of the legacy oracle.
    ///
    /// Old oracle didn't specify what slot use as a reference one, but actually
    /// used the first slot of the first frame's epoch. The new oracle uses the
    /// last slot of the previous frame's last epoch as a reference one.
    ///
    /// Oracle migration scheme:
    ///
    /// last old frame    <--------->
    /// old frames       |r  .   .   |
    /// new frames                  r|   .   .  r|   .   .  r|
    /// first new frame               <--------->
    /// events            0  1  2   3  4
    /// time ------------------------------------------------>
    ///
    /// 0. last reference slot of legacy oracle
    /// 1. last legacy oracle's consensus report arrives
    /// 2. new oracle is deployed and enabled, legacy oracle is disabled and upgraded to compat code
    /// 3. first reference slot of the new oracle
    /// 4. first new oracle's consensus report arrives
    ///
    function _checkOracleMigration(
        address legacyOracle,
        address consensusContract
    )
        internal view returns (uint256)
    {
        (uint256 initialEpoch,
            uint256 epochsPerFrame) = IConsensusContract(consensusContract).getFrameConfig();

        (uint256 slotsPerEpoch,
            uint256 secondsPerSlot,
            uint256 genesisTime) = IConsensusContract(consensusContract).getChainConfig();

        {
            // check chain spec to match the prev. one (a block is used to reduce stack alloc)
            (uint256 legacyEpochsPerFrame,
                uint256 legacySlotsPerEpoch,
                uint256 legacySecondsPerSlot,
                uint256 legacyGenesisTime) = ILegacyOracle(legacyOracle).getBeaconSpec();
            if (slotsPerEpoch != legacySlotsPerEpoch ||
                secondsPerSlot != legacySecondsPerSlot ||
                genesisTime != legacyGenesisTime
            ) {
                revert IncorrectOracleMigration(0);
            }
            if (epochsPerFrame != legacyEpochsPerFrame) {
                revert IncorrectOracleMigration(1);
            }
        }

        uint256 legacyProcessedEpoch = ILegacyOracle(legacyOracle).getLastCompletedEpochId();
        if (initialEpoch != legacyProcessedEpoch + epochsPerFrame) {
            revert IncorrectOracleMigration(2);
        }

        // last processing ref. slot of the new oracle should be set to the last processed
        // ref. slot of the legacy oracle, i.e. the first slot of the last processed epoch
        return legacyProcessedEpoch * slotsPerEpoch;
    }

    function _handleConsensusReport(
        ConsensusReport memory /* report */,
        uint256 /* prevSubmittedRefSlot */,
        uint256 prevProcessingRefSlot
    ) internal override {
        ExtraDataProcessingState memory state = _storageExtraDataProcessingState().value;
        if (state.refSlot == prevProcessingRefSlot && state.itemsProcessed < state.itemsCount) {
            emit WarnExtraDataIncompleteProcessing(
                prevProcessingRefSlot,
                state.itemsProcessed,
                state.itemsCount
            );
        }
    }

    function _checkMsgSenderIsAllowedToSubmitData() internal view {
        address sender = _msgSender();
        if (!hasRole(SUBMIT_DATA_ROLE, sender) && !_isConsensusMember(sender)) {
            revert SenderNotAllowed();
        }
    }

    function _handleConsensusReportData(ReportData calldata data, uint256 prevRefSlot) internal {
        if (data.extraDataFormat != EXTRA_DATA_FORMAT_LIST) {
            revert UnsupportedExtraDataFormat(data.extraDataFormat);
        }

        IOracleReportSanityChecker(LOCATOR.oracleReportSanityChecker())
            .checkAccountingExtraDataListItemsCount(data.extraDataItemsCount);

        ILegacyOracle(LEGACY_ORACLE).handleConsensusLayerReport(
            data.refSlot,
            data.clBalanceGwei * 1e9,
            data.numValidators
        );

        uint256 slotsElapsed = data.refSlot - prevRefSlot;

        IStakingRouter stakingRouter = IStakingRouter(LOCATOR.stakingRouter());
        IWithdrawalQueue withdrawalQueue = IWithdrawalQueue(LOCATOR.withdrawalQueue());

        _processStakingRouterExitedValidatorsByModule(
            stakingRouter,
            data.stakingModuleIdsWithNewlyExitedValidators,
            data.numExitedValidatorsByStakingModule,
            slotsElapsed
        );

        withdrawalQueue.updateBunkerMode(
            data.isBunkerMode,
            GENESIS_TIME + prevRefSlot * SECONDS_PER_SLOT
        );

        ILido(LIDO).handleOracleReport(
            GENESIS_TIME + data.refSlot * SECONDS_PER_SLOT,
            slotsElapsed * SECONDS_PER_SLOT,
            data.numValidators,
            data.clBalanceGwei * 1e9,
            data.withdrawalVaultBalance,
            data.elRewardsVaultBalance,
            data.lastWithdrawalRequestIdToFinalize,
            data.finalizationShareRate
        );

        _storageExtraDataProcessingState().value = ExtraDataProcessingState({
            refSlot: data.refSlot.toUint64(),
            dataFormat: data.extraDataFormat.toUint16(),
            dataHash: data.extraDataHash,
            itemsCount: data.extraDataItemsCount.toUint16(),
            itemsProcessed: 0,
            lastSortingKey: 0
        });
    }

    function _processStakingRouterExitedValidatorsByModule(
        IStakingRouter stakingRouter,
        uint256[] calldata stakingModuleIds,
        uint256[] calldata numExitedValidatorsByStakingModule,
        uint256 slotsElapsed
    ) internal {
        if (stakingModuleIds.length != numExitedValidatorsByStakingModule.length) {
            revert InvalidExitedValidatorsData();
        }

        if (stakingModuleIds.length == 0) {
            return;
        }

        for (uint256 i = 1; i < stakingModuleIds.length;) {
            if (stakingModuleIds[i] <= stakingModuleIds[i - 1]) {
                revert InvalidExitedValidatorsData();
            }
            unchecked { ++i; }
        }

        uint256 exitedValidators = 0;
        for (uint256 i = 0; i < stakingModuleIds.length;) {
            if (numExitedValidatorsByStakingModule[i] == 0) {
                revert InvalidExitedValidatorsData();
            } else {
                exitedValidators += numExitedValidatorsByStakingModule[i];
            }
            unchecked { ++i; }
        }

        uint256 prevExitedValidators = stakingRouter.getExitedValidatorsCountAcrossAllModules();
        if (exitedValidators < prevExitedValidators) {
            revert NumExitedValidatorsCannotDecrease();
        }

        uint256 exitedValidatorsPerDay =
            (exitedValidators - prevExitedValidators) * (1 days) /
            (SECONDS_PER_SLOT * slotsElapsed);

        IOracleReportSanityChecker(LOCATOR.oracleReportSanityChecker())
            .checkExitedValidatorsRatePerDay(exitedValidatorsPerDay);

        stakingRouter.updateExitedValidatorsCountByStakingModule(
            stakingModuleIds,
            numExitedValidatorsByStakingModule
        );
    }

    struct ExtraDataIterState {
        // volatile
        uint256 index;
        uint256 itemType;
        uint256 dataOffset;
        uint256 lastSortingKey;
        // config
        address stakingRouter;
    }

    function _submitReportExtraDataList(bytes calldata items) internal {
        _checkMsgSenderIsAllowedToSubmitData();
        _checkProcessingDeadline();

        ExtraDataProcessingState memory procState = _storageExtraDataProcessingState().value;

        if (procState.refSlot != LAST_PROCESSING_REF_SLOT_POSITION.getStorageUint256()) {
            revert CannotSubmitExtraDataBeforeMainData();
        }

        if (procState.itemsProcessed == procState.itemsCount) {
            revert ExtraDataAlreadyProcessed();
        }

        if (procState.itemsProcessed != 0) {
            revert ExtraDataListOnlySupportsSingleTx();
        }

        if (procState.dataFormat != EXTRA_DATA_FORMAT_LIST) {
            revert UnexpectedExtraDataFormat(procState.dataFormat, EXTRA_DATA_FORMAT_LIST);
        }

        bytes32 dataHash = keccak256(items);
        if (dataHash != procState.dataHash) {
            revert UnexpectedDataHash(procState.dataHash, dataHash);
        }

        ExtraDataIterState memory iter = ExtraDataIterState({
            index: 0,
            itemType: 0,
            dataOffset: 0,
            lastSortingKey: 0,
            stakingRouter: LOCATOR.stakingRouter()
        });

        _processExtraDataItems(items, iter);
        uint256 itemsProcessed = iter.index + 1;

        if (itemsProcessed != procState.itemsCount) {
            revert UnexpectedExtraDataItemsCount(procState.itemsCount, itemsProcessed);
        }

        ExtraDataProcessingState storage _procState = _storageExtraDataProcessingState().value;
        _procState.itemsProcessed = uint64(itemsProcessed);
        _procState.lastSortingKey = iter.lastSortingKey;

        emit ExtraDataSubmitted(procState.refSlot, itemsProcessed, itemsProcessed);
    }

    function _processExtraDataItems(bytes calldata data, ExtraDataIterState memory iter) internal {
        uint256 dataOffset = iter.dataOffset;

        /// @solidity memory-safe-assembly
        while (dataOffset < data.length) {
            uint256 index;
            uint256 itemType;

            assembly {
                // layout at the dataOffset:
                // |  3 bytes  | 2 bytes  |   X bytes   |
                // | itemIndex | itemType | itemPayload |
                let header := calldataload(add(data.offset, dataOffset))
                index := shr(232, header)
                itemType := and(shr(216, header), 0xffff)
                dataOffset := add(dataOffset, 5)
            }

            if (iter.itemType == 0) {
                if (index != 0) {
                    revert UnexpectedExtraDataIndex(0, index);
                }
            } else if (index != iter.index + 1) {
                revert UnexpectedExtraDataIndex(iter.index + 1, index);
            }

            iter.index = index;
            iter.itemType = itemType;
            iter.dataOffset = dataOffset;

            if (itemType == EXTRA_DATA_TYPE_EXITED_VALIDATORS ||
                itemType == EXTRA_DATA_TYPE_STUCK_VALIDATORS
            ) {
                _processExtraDataItem(data, iter);
            } else {
                revert UnsupportedExtraDataType(index, itemType);
            }

            assert(iter.dataOffset > dataOffset);
            dataOffset = iter.dataOffset;
        }
    }

    function _processExtraDataItem(bytes calldata data, ExtraDataIterState memory iter) internal {
        uint256 dataOffset = iter.dataOffset;
        uint256 moduleId;
        uint256 nodeOpsCount;
        uint256 firstNodeOpId;
        bytes calldata nodeOpIds;
        bytes calldata valsCounts;

        if (dataOffset + 35 > data.length) {
            // has to fit at least moduleId (3 bytes), nodeOpsCount (8 bytes),
            // and data for one node operator (8 + 16 bytes), total 35 bytes
            revert InvalidExtraDataItem(iter.index);
        }

        /// @solidity memory-safe-assembly
        assembly {
            // layout at the dataOffset:
            // | 3 bytes  |   8 bytes    |  nodeOpsCount * 8 bytes  |  nodeOpsCount * 16 bytes  |
            // | moduleId | nodeOpsCount |      nodeOperatorIds     |      validatorsCounts     |
            let header := calldataload(add(data.offset, dataOffset))
            moduleId := shr(232, header)
            nodeOpsCount := and(shr(168, header), 0xffffffffffffffff)
            nodeOpIds.offset := add(data.offset, add(dataOffset, 11))
            nodeOpIds.length := mul(nodeOpsCount, 8)
            firstNodeOpId := shr(192, calldataload(nodeOpIds.offset))
            valsCounts.offset := add(nodeOpIds.offset, nodeOpIds.length)
            valsCounts.length := mul(nodeOpsCount, 16)
            dataOffset := sub(add(valsCounts.offset, valsCounts.length), data.offset)
        }

        if (moduleId == 0) {
            revert InvalidExtraDataItem(iter.index);
        }

        unchecked {
            // | 2 bytes  | 19 bytes | 3 bytes  |    8 bytes    |
            // | itemType | 00000000 | moduleId | firstNodeOpId |
            uint256 sortingKey = (iter.itemType << 240) | (moduleId << 64) | firstNodeOpId;
            if (sortingKey <= iter.lastSortingKey) {
                revert InvalidExtraDataSortOrder(iter.index);
            }
            iter.lastSortingKey = sortingKey;
        }

        if (dataOffset > data.length || nodeOpsCount == 0) {
            revert InvalidExtraDataItem(iter.index);
        }

        IOracleReportSanityChecker(LOCATOR.oracleReportSanityChecker())
            .checkNodeOperatorsPerExtraDataItemCount(iter.index, nodeOpsCount);

        if (iter.itemType == EXTRA_DATA_TYPE_STUCK_VALIDATORS) {
            IStakingRouter(iter.stakingRouter)
                .reportStakingModuleStuckValidatorsCountByNodeOperator(moduleId, nodeOpIds, valsCounts);
        } else {
            IStakingRouter(iter.stakingRouter)
                .reportStakingModuleExitedValidatorsCountByNodeOperator(moduleId, nodeOpIds, valsCounts);
        }

        iter.dataOffset = dataOffset;
    }

    ///
    /// Storage helpers
    ///

    struct StorageExtraDataProcessingState {
        ExtraDataProcessingState value;
    }

    function _storageExtraDataProcessingState()
        internal pure returns (StorageExtraDataProcessingState storage r)
    {
        bytes32 position = EXTRA_DATA_PROCESSING_STATE_POSITION;
        assembly { r.slot := position }
    }
}
