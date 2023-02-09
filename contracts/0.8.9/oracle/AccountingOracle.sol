// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { ILidoLocator } from "../../common/interfaces/ILidoLocator.sol";
import { MemUtils } from "../../common/lib/MemUtils.sol";
import { ResizableArray } from "../lib/ResizableArray.sol";
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


interface IStakingRouter {
    function getExitedKeysCountAcrossAllModules() external view returns (uint256);

    function updateExitedKeysCountByStakingModule(
        uint256[] calldata _moduleIds,
        uint256[] calldata _exitedKeysCounts
    ) external;

    function reportStakingModuleExitedKeysCountByNodeOperator(
        uint256 _stakingModuleId,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _exitedKeysCounts
    ) external;

    function reportStakingModuleStuckKeysCountByNodeOperator(
        uint256 _stakingModuleId,
        uint256[] calldata _nodeOperatorIds,
        uint256[] calldata _stuckKeysCounts
    ) external;
}


interface IWithdrawalQueue {
    function updateBunkerMode(bool isBunkerMode, uint256 prevReportTimestamp) external;
}


contract AccountingOracle is BaseOracle {
    using ResizableArray for ResizableArray.Array;
    using UnstructuredStorage for bytes32;
    using SafeCast for uint256;

    error LidoLocatorCannotBeZero();
    error AdminCannotBeZero();
    error LegacyOracleCannotBeZero();
    error IncorrectOracleMigration(uint256 code);
    error SenderNotAllowed();
    error InvalidExitedValidatorsData();
    error NumExitedValidatorsCannotDecrease();
    error ExitedValidatorsLimitExceeded(uint256 limitPerDay, uint256 exitedPerDay);
    error UnsupportedExtraDataFormat(uint256 format);
    error UnsupportedExtraDataType(uint256 dataType);
    error MaxExtraDataItemsCountExceeded(uint256 maxItemsCount, uint256 receivedItemsCount);
    error CannotSubmitExtraDataBeforeMainData();
    error ExtraDataAlreadyProcessed();
    error ExtraDataListOnlySupportsSingleTx();
    error UnexpectedExtraDataFormat(uint256 expectedFormat, uint256 receivedFormat);
    error UnexpectedExtraDataItemsCount(uint256 expectedCount, uint256 receivedCount);
    error UnexpectedExtraDataIndex(uint256 expectedIndex, uint256 receivedIndex);
    error InvalidExtraDataSortOrder();

    event DataBoundariesSet(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount);
    event ExtraDataSubmitted(uint256 indexed refSlot, uint256 itemsProcessed, uint256 itemsCount);

    event WarnExtraDataIncompleteProcessing(
        uint256 indexed refSlot,
        uint256 processedItemsCount,
        uint256 itemsCount
    );

    struct DataBoundaries {
        uint64 maxExitedValidatorsPerDay;
        uint64 maxExtraDataListItemsCount;
    }

    struct ExtraDataProcessingState {
        uint64 refSlot;
        uint16 dataFormat;
        uint32 maxNodeOpsCountByModule;
        uint64 itemsCount;
        uint64 itemsProcessed;
        uint256 lastProcessedItem;
        bytes32 dataHash;
    }

    /// @notice An ACL role granting the permission to submit the data for a committee report.
    bytes32 public constant SUBMIT_DATA_ROLE = keccak256("SUBMIT_DATA_ROLE");

    /// @notice An ACL role granting the permission to set report data safety boundaries.
    bytes32 constant public MANAGE_DATA_BOUNDARIES_ROLE = keccak256("MANAGE_DATA_BOUNDARIES_ROLE");


    /// @dev Storage slot: DataBoundaries dataBoundaries
    bytes32 internal constant DATA_BOUNDARIES_POSITION =
        keccak256("lido.AccountingOracle.dataBoundaries");

    /// @dev Storage slot: ExtraDataProcessingState state
    bytes32 internal constant EXTRA_DATA_PROCESSING_STATE_POSITION =
        keccak256("lido.AccountingOracle.extraDataProcessingState");

    /// @dev Storage slot: address legacyOracle
    bytes32 internal constant LEGACY_ORACLE_POSITION =
        keccak256("lido.AccountingOracle.legacyOracle");


    address public immutable LIDO;
    ILidoLocator public immutable LOCATOR;

    ///
    /// Initialization & admin functions
    ///

    constructor(address lidoLocator, address lido, uint256 secondsPerSlot, uint256 genesisTime)
        BaseOracle(secondsPerSlot, genesisTime)
    {
        if (lidoLocator == address(0)) revert LidoLocatorCannotBeZero();
        LOCATOR = ILidoLocator(lidoLocator);
        LIDO = lido;
    }

    function initialize(
        address admin,
        address consensusContract,
        uint256 consensusVersion,
        address legacyOracle,
        uint256 maxExitedValidatorsPerDay,
        uint256 maxExtraDataListItemsCount
    ) external {
        if (admin == address(0)) revert AdminCannotBeZero();
        if (legacyOracle == address(0)) revert LegacyOracleCannotBeZero();
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        uint256 lastProcessingRefSlot = _checkOracleMigration(legacyOracle, consensusContract);
        LEGACY_ORACLE_POSITION.setStorageAddress(legacyOracle);
        _initialize(consensusContract, consensusVersion, lastProcessingRefSlot);
        _setDataBoundaries(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
    }

    function getDataBoundaries() external view returns (
        uint256 maxExitedValidatorsPerDay,
        uint256 maxExtraDataListItemsCount
    ) {
        DataBoundaries memory b = _storageDataBoundaries().value;
        return (b.maxExitedValidatorsPerDay, b.maxExtraDataListItemsCount);
    }

    function setDataBoundaries(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount)
        external
        onlyRole(MANAGE_DATA_BOUNDARIES_ROLE)
    {
        _setDataBoundaries(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
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
        ///    3 bytes    2 bytes     27 bytes
        /// | itemIndex | itemType | itemPayload |
        ///
        /// itemIndex is a 0-based index into the extra data array;
        /// itemType is the type of extra data item;
        /// itemPayload is the item's data which interpretation depends on the item's type.
        ///
        /// Two types of items are supported:
        ///
        /// itemType=EXTRA_DATA_TYPE_STUCK_VALIDATORS: stuck validators by node operator.
        /// itemPayload format:
        ///
        ///   3 bytes        8 bytes            16 bytes
        /// | moduleId | nodeOperatorId | totalStuckValidators |
        ///
        /// itemType=EXTRA_DATA_TYPE_EXITED_VALIDATORS: exited validators by node operator.
        /// itemPayload format:
        ///
        ///   3 bytes        8 bytes             16 bytes
        /// | moduleId | nodeOperatorId | totalExitedValidators |
        ///
        /// Extra data array should be sorted in ascending order by the following compound key:
        ///
        /// (itemType, moduleId, nodeOperatorId)
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

        /// @dev The highest number of items with unique nodeOperatorId among the extra data
        /// items with any given (itemType, moduleId) pair. Must not exceed 2^32 - 1.
        ///
        /// For example, for the following extra data:
        ///
        ///   itemType: ST, moduleId: 1, nodeOperatorId: 1, totalStuckValidators: 111
        ///   itemType: ST, moduleId: 1, nodeOperatorId: 2, totalStuckValidators: 222
        ///
        ///   itemType: ST, moduleId: 2, nodeOperatorId: 1, totalStuckValidators: 111
        ///   itemType: ST, moduleId: 2, nodeOperatorId: 3, totalStuckValidators: 333
        ///   itemType: ST, moduleId: 2, nodeOperatorId: 5, totalStuckValidators: 555
        ///   itemType: ST, moduleId: 2, nodeOperatorId: 7, totalStuckValidators: 777
        ///
        ///   itemType: EX, moduleId: 1, nodeOperatorId: 5, totalExitedValidators: 555
        ///   itemType: EX, moduleId: 1, nodeOperatorId: 8, totalExitedValidators: 888
        ///   itemType: EX, moduleId: 1, nodeOperatorId: 9, totalExitedValidators: 999
        ///
        /// extraDataMaxNodeOpsCountByModule should be set to 4 since this is the number of data
        /// items with unique nodeOperatorId for itemType=EXTRA_DATA_TYPE_STUCK_VALIDATORS and
        /// moduleId=2, and any other (itemType, moduleId) pair doesn't yield a higher number of
        /// items with unique nodeOperatorId.
        ///
        uint256 extraDataMaxNodeOpsCountByModule;
    }

    uint256 public constant EXTRA_DATA_TYPE_STUCK_VALIDATORS = 0;
    uint256 public constant EXTRA_DATA_TYPE_EXITED_VALIDATORS = 1;

    /// @notice The list format for the extra data array. Used when all extra data processing
    /// fits into a single transaction.
    ///
    /// Extra data is passed as a uint256[] array containing all data items within a
    /// single transaction.
    ///
    /// Hash is a keccak256 hash calculated over the array items laid out continuously in memory,
    /// each item occupying 32 bytes. The Solidity equivalent of the hash calculation code would
    /// be the following (where `array` has the uint256[] type):
    ///
    /// keccak256(abi.encodePacked(array))
    ///
    uint256 public constant EXTRA_DATA_FORMAT_LIST = 0;

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
        _checkConsensusData(data.refSlot, data.consensusVersion, keccak256(abi.encode(data)));
        uint256 prevRefSlot = _startProcessing();
        _handleConsensusReportData(data, prevRefSlot);
    }

    /// @notice Submits report extra data in the EXTRA_DATA_FORMAT_LIST format for processing.
    ///
    /// @param items The extra data items list. See docs for the `EXTRA_DATA_FORMAT_LIST`
    ///              constant for details.
    ///
    function submitReportExtraDataList(uint256[] calldata items) external {
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
    function _checkOracleMigration(address legacyOracle, address consensusContract)
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

    function _setDataBoundaries(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount)
        internal
    {
        _storageDataBoundaries().value = DataBoundaries({
            maxExitedValidatorsPerDay: maxExitedValidatorsPerDay.toUint64(),
            maxExtraDataListItemsCount: maxExtraDataListItemsCount.toUint64()
        });
        emit DataBoundariesSet(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
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
        DataBoundaries memory boundaries = _storageDataBoundaries().value;

        if (data.extraDataFormat != EXTRA_DATA_FORMAT_LIST) {
            revert UnsupportedExtraDataFormat(data.extraDataFormat);
        }

        if (data.extraDataItemsCount > boundaries.maxExtraDataListItemsCount) {
            revert MaxExtraDataItemsCountExceeded(
                boundaries.maxExtraDataListItemsCount,
                data.extraDataItemsCount
            );
        }

        ILegacyOracle(LEGACY_ORACLE_POSITION.getStorageAddress()).handleConsensusLayerReport(
            data.refSlot,
            data.clBalanceGwei * 1e9,
            data.numValidators
        );

        uint256 slotsElapsed = data.refSlot - prevRefSlot;

        IStakingRouter stakingRouter = IStakingRouter(LOCATOR.stakingRouter());
        IWithdrawalQueue withdrawalQueue = IWithdrawalQueue(LOCATOR.withdrawalQueue());

        _processStakingRouterExitedKeysByModule(
            stakingRouter,
            boundaries,
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
            maxNodeOpsCountByModule: data.extraDataMaxNodeOpsCountByModule.toUint32(),
            itemsCount: data.extraDataItemsCount.toUint16(),
            itemsProcessed: 0,
            lastProcessedItem: 0
        });
    }

    function _processStakingRouterExitedKeysByModule(
        IStakingRouter stakingRouter,
        DataBoundaries memory boundaries,
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

        uint256 prevExitedValidators = stakingRouter.getExitedKeysCountAcrossAllModules();
        if (exitedValidators < prevExitedValidators) {
            revert NumExitedValidatorsCannotDecrease();
        }

        uint256 exitedValidatorsPerDay =
            (exitedValidators - prevExitedValidators) * (1 days) /
            (SECONDS_PER_SLOT * slotsElapsed);

        if (exitedValidatorsPerDay > boundaries.maxExitedValidatorsPerDay) {
            revert ExitedValidatorsLimitExceeded(
                boundaries.maxExitedValidatorsPerDay,
                exitedValidatorsPerDay
            );
        }

        stakingRouter.updateExitedKeysCountByStakingModule(
            stakingModuleIds,
            numExitedValidatorsByStakingModule
        );
    }

    function _submitReportExtraDataList(uint256[] calldata items) internal {
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

        if (items.length != procState.itemsCount) {
            revert UnexpectedExtraDataItemsCount(procState.itemsCount, items.length);
        }

        if (procState.dataFormat != EXTRA_DATA_FORMAT_LIST) {
            revert UnexpectedExtraDataFormat(procState.dataFormat, EXTRA_DATA_FORMAT_LIST);
        }

        bytes32 dataHash = MemUtils.keccakUint256Array(items);
        if (dataHash != procState.dataHash) {
            revert UnexpectedDataHash(procState.dataHash, dataHash);
        }

        ExtraDataProcessingState storage _procState = _storageExtraDataProcessingState().value;

        _procState.lastProcessedItem = _processExtraDataItems(
            items,
            procState.itemsProcessed,
            procState.lastProcessedItem,
            procState.maxNodeOpsCountByModule
        );

        _procState.itemsProcessed = uint64(items.length);

        emit ExtraDataSubmitted(procState.refSlot, items.length, items.length);
    }

    struct ExtraDataIterState {
        uint256 firstItemIndex;
        uint256 nextIndex;
        int256 lastType;
        int256 lastModuleId;
        int256 lastNodeOpId;
        ResizableArray.Array nopIds;
        ResizableArray.Array keyCounts;
    }

    function _processExtraDataItems(
        uint256[] calldata items,
        uint256 itemsProcessed,
        uint256 lastProcessedItem,
        uint256 maxNodeOpsCountByModule
    ) internal returns (uint256) {
        IStakingRouter stakingRouter = IStakingRouter(LOCATOR.stakingRouter());

        ExtraDataIterState memory iter = ExtraDataIterState({
            firstItemIndex: itemsProcessed,
            nextIndex: 0,
            lastType: -1,
            lastModuleId: -1,
            lastNodeOpId: -1,
            nopIds: ResizableArray.preallocate(maxNodeOpsCountByModule),
            keyCounts: ResizableArray.preallocate(maxNodeOpsCountByModule)
        });

        if (lastProcessedItem != 0) {
            (, uint256 itemType, uint216 payload) = _decodeExtraDataItem(lastProcessedItem);
            (uint256 moduleId, uint256 nodeOpId, ) = _decodeExtraDataPayload(payload);
            iter.lastType = int256(itemType);
            iter.lastModuleId = int256(moduleId);
            iter.lastNodeOpId = int256(nodeOpId);
        }

        while (iter.nextIndex < items.length) {
            iter.nopIds.clear();
            iter.keyCounts.clear();

            _processSingleModule(iter, items);

            if (iter.lastType != -1) {
                assert(iter.lastModuleId >= 0);
                assert(iter.lastNodeOpId >= 0);

                if (iter.lastType == int256(EXTRA_DATA_TYPE_STUCK_VALIDATORS)) {
                    stakingRouter.reportStakingModuleStuckKeysCountByNodeOperator(
                        uint256(iter.lastModuleId),
                        iter.nopIds.pointer(),
                        iter.keyCounts.pointer()
                    );
                } else if (iter.lastType == int256(EXTRA_DATA_TYPE_EXITED_VALIDATORS)) {
                    stakingRouter.reportStakingModuleExitedKeysCountByNodeOperator(
                        uint256(iter.lastModuleId),
                        iter.nopIds.pointer(),
                        iter.keyCounts.pointer()
                    );
                } else {
                    revert UnsupportedExtraDataType(uint256(iter.lastType));
                }
            }
        }

        return iter.nextIndex == 0 ? 0 : items[iter.nextIndex - 1];
    }

    function _processSingleModule(ExtraDataIterState memory iter, uint256[] calldata items)
        internal pure
    {
        if (items.length == 0) {
            return;
        }

        uint256 i = iter.nextIndex;
        bool started = false;

        uint256 itemType;
        uint256 moduleId;
        uint256 lastNodeOpId;

        while (i < items.length) {
            (uint256 iIndex, uint256 iType, uint216 iPayload) = _decodeExtraDataItem(items[i]);

            if (iIndex != iter.firstItemIndex + i) {
                revert UnexpectedExtraDataIndex(iter.firstItemIndex + i, iIndex);
            }

            (uint256 iModuleId, uint256 iNodeOpId, uint256 iKeysCount) =
                _decodeExtraDataPayload(iPayload);

            if (started) {
                if (iType != itemType || iModuleId != moduleId) {
                    break;
                }
                if (iNodeOpId <= lastNodeOpId) {
                    revert InvalidExtraDataSortOrder();
                }
            } else {
                if (int256(iType) < iter.lastType || int256(iType) == iter.lastType && (
                    int256(iModuleId) < iter.lastModuleId ||
                    int256(iModuleId) == iter.lastModuleId && int256(iNodeOpId) <= iter.lastNodeOpId
                )) {
                    revert InvalidExtraDataSortOrder();
                }
                itemType = iType;
                moduleId = iModuleId;
                started = true;
            }

            iter.nopIds.push(iNodeOpId);
            iter.keyCounts.push(iKeysCount);
            lastNodeOpId = iNodeOpId;

            unchecked { ++i; }
        }

        iter.nextIndex = i;
        iter.lastType = int256(itemType);
        iter.lastModuleId = int256(moduleId);
        iter.lastNodeOpId = int256(lastNodeOpId);
    }

    function _decodeExtraDataItem(uint256 item) internal pure returns (
        uint24 itemIndex,
        uint16 itemType,
        uint216 itemPayload
    ) {
        itemPayload = uint216(item);
        itemType = uint16(item >> 216);
        itemIndex = uint24(item >> 232);
    }

    function _decodeExtraDataPayload(uint216 payload) internal pure returns (
        uint24 moduleId,
        uint64 nodeOperatorId,
        uint128 keysCount
    ) {
        keysCount = uint128(payload);
        nodeOperatorId = uint64(payload >> 128);
        moduleId = uint24(payload >> 192);
    }

    ///
    /// Storage helpers
    ///

    struct StorageDataBoundaries {
        DataBoundaries value;
    }

    function _storageDataBoundaries() internal pure returns (StorageDataBoundaries storage r) {
        bytes32 position = DATA_BOUNDARIES_POSITION;
        assembly { r.slot := position }
    }

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
