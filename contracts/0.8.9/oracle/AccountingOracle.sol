// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;


import { SafeCast } from "@openzeppelin/contracts-v4.4/utils/math/SafeCast.sol";

import { IOracleReportReceiver, IStakingRouterProvider } from "../interfaces/ILido.sol";
import { IStakingRouterExitedKeys } from "../interfaces/IStakingRouter.sol";
import { MemUtils } from "../../common/lib/MemUtils.sol";
import { ResizableArray } from "../lib/ResizableArray.sol";
import { UnstructuredStorage } from "../lib/UnstructuredStorage.sol";

import { BaseOracle } from "./BaseOracle.sol";


interface ILido is IOracleReportReceiver, IStakingRouterProvider {}
interface IStakingRouter is IStakingRouterExitedKeys {}


contract AccountingOracle is BaseOracle {
    using ResizableArray for ResizableArray.Array;
    using UnstructuredStorage for bytes32;
    using SafeCast for uint256;

    error LidoCannotBeZero();
    error AdminCannotBeZero();
    error SenderNotAllowed();
    error UnexpectedDataHash(bytes32 consensusHash, bytes32 receivedHash);
    error InvalidExitedValidatorsData();
    error NumExitedValidatorsCannotDecrease();
    error ExitedValidatorsLimitExceeded(uint256 limitPerDay, uint256 exitedPerDay);
    error UnsupportedExtraDataFormat(uint256 format);
    error UnsupportedExtraDataType(uint256 dataType);
    error MaxExtraDataItemsCountExceeded(uint256 maxItemsCount, uint256 receivedItemsCount);
    error CannotProcessExtraDataBeforeMainData();
    error ExtraDataAlreadyProcessed();
    error ExtraDataListOnlySupportsSingleTx();
    error UnexpectedExtraDataFormat(uint256 expectedFormat, uint256 receivedFormat);
    error UnexpectedExtraDataItemsCount(uint256 expectedCount, uint256 receivedCount);
    error UnexpectedExtraDataIndex(uint256 expectedIndex, uint256 receivedIndex);
    error InvalidExtraDataSortOrder();

    event DataBoundraiesSet(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount);
    event DataSubmitted(uint256 indexed refSlot);
    event ExtraDataSubmitted(uint256 indexed refSlot, uint256 itemsProcessed, uint256 itemsCount);

    event WarnExtraDataIncomleteProcessing(
        uint256 indexed refSlot,
        uint256 processedItemsCount,
        uint256 itemsCount
    );

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
        /// itemType=0: stuck validators by node operator. itemPayload format:
        ///
        ///   3 bytes        8 bytes            16 bytes
        /// | moduleId | nodeOperatorId | totalStuckValidators |
        ///
        /// itemType=1: exited validators by node operator. itemPayload format:
        ///
        ///   3 bytes        8 bytes             16 bytes
        /// | moduleId | nodeOperatorId | totalExitedValidators |
        ///
        /// Extra data array should be sorted in ascending order by the following compound key:
        ///
        /// (itemType, moduleId, nodeOperatorId)
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
    /// keccac256(abi.encodePacked(array))
    ///
    uint256 public constant EXTRA_DATA_FORMAT_LIST = 0;

    uint256 public constant EXTRA_DATA_TYPE_STUCK_VALIDATORS = 0;
    uint256 public constant EXTRA_DATA_TYPE_EXITED_VALIDATORS = 1;

    struct DataBoundraies {
        uint64 maxExitedValidatorsPerDay;
        uint64 maxExtraDataListItemsCount;
    }

    struct ExtraDataProcessingState {
        uint256 lastProcessedItem;
        bytes32 dataHash;
        uint16 dataFormat;
        uint64 itemsCount;
        uint64 itemsProcessed;
    }

    /// @notice An ACL role granting the permission to submit the data for a commitee report.
    bytes32 public constant SUBMIT_DATA_ROLE = keccak256("SUBMIT_DATA_ROLE");

    /// @notice An ACL role granting the permission to set report data safety boundaries.
    bytes32 constant public MANAGE_DATA_BOUNDARIES_ROLE = keccak256("MANAGE_DATA_BOUNDARIES_ROLE");


    /// @dev Storage slot: DataBoundraies dataBoundaries
    bytes32 internal constant DATA_BOUNDARIES_POSITION =
        keccak256("lido.AccountingOracle.dataBoundaries");

    /// @dev Storage slot: ExtraDataProcessingState state
    bytes32 internal constant EXTRA_DATA_PROCESSING_STATE_POSITION =
        keccak256("lido.AccountingOracle.extraDataProcessingState");


    address public immutable LIDO;
    uint256 public immutable SECONDS_PER_SLOT;


    constructor(address lido, uint256 secondsPerSlot) {
        if (lido == address(0)) revert LidoCannotBeZero();
        LIDO = lido;
        SECONDS_PER_SLOT = secondsPerSlot;
    }

    function initialize(
        address admin,
        address consensusContract,
        uint256 consensusVersion,
        uint256 lastProcessedRefSlot,
        uint256 maxExitedValidatorsPerDay,
        uint256 maxExtraDataListItemsCount
    ) external {
        if (admin == address(0)) revert AdminCannotBeZero();
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _initialize(consensusContract, consensusVersion, lastProcessedRefSlot);
        _setDataBoundaries(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
    }

    function getDataBoundaries() external view returns (
        uint256 maxExitedValidatorsPerDay,
        uint256 maxExtraDataListItemsCount
    ) {
        DataBoundraies memory b = _storageDataBoundaries().value;
        return (b.maxExitedValidatorsPerDay, b.maxExtraDataListItemsCount);
    }

    function setDataBoundaries(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount)
        external
        onlyRole(MANAGE_DATA_BOUNDARIES_ROLE)
    {
        _setDataBoundaries(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
    }

    function _setDataBoundaries(uint256 maxExitedValidatorsPerDay, uint256 maxExtraDataListItemsCount)
        internal
    {
        _storageDataBoundaries().value = DataBoundraies({
            maxExitedValidatorsPerDay: maxExitedValidatorsPerDay.toUint64(),
            maxExtraDataListItemsCount: maxExtraDataListItemsCount.toUint64()
        });
        emit DataBoundraiesSet(maxExitedValidatorsPerDay, maxExtraDataListItemsCount);
    }

    function _startProcessing(ConsensusReport memory /* report */) internal override {
        ExtraDataProcessingState memory extraProcState = _storageExtraDataProcessingState().value;
        if (extraProcState.itemsProcessed < extraProcState.itemsCount) {
            emit WarnExtraDataIncomleteProcessing(
                LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256(),
                extraProcState.itemsProcessed,
                extraProcState.itemsCount);
        }
        // prevent any further processing of previous extra data
        _storageExtraDataProcessingState().value.dataHash = bytes32(0);
    }

    ///
    /// Data provider interface: main data
    ///

    /// @notice Submits the full report data.
    ///
    /// @param data The report data.
    /// @param contractVersion Expected version of the oracle contract.
    ///
    /// Reverts if the caller is not a member of the oracle committee and doesn't
    /// possess the SUBMIT_DATA_ROLE.
    ///
    /// Reverts if the provided contract version is different from the current one.
    ///
    /// Reverts if the provided consensus version is different from the current one.
    ///
    /// Reverts if the keccak256 hash of the ABI-encoded data is different from the last hash
    /// provided by the hash consensus contract.
    ///
    /// Reverts if the processing deadline for the reference slot's consensus frame is not met.
    ///
    /// Reverts if the provided data doesn't meet safety checks and boundaries.
    ///
    function submitReportData(ReportData calldata data, uint256 contractVersion) external {
        _checkMsgSenderIsAllowedToSubmitData();
        _checkContractVersion(contractVersion);
        _checkConsensusData(data.refSlot, data.consensusVersion);
        _checkReportDataHash(data);
        _handleConsensusReportData(data);
        _finishProcessing();
    }

    function _checkMsgSenderIsAllowedToSubmitData() internal view {
        address sender = _msgSender();
        if (!hasRole(SUBMIT_DATA_ROLE, sender) && !_isConsensusMember(sender)) {
            revert SenderNotAllowed();
        }
    }

    function _checkReportDataHash(ReportData calldata data) internal view {
        bytes32 consensusHash = _storageProcessingReport().value.hash;
        bytes32 dataHash = keccak256(abi.encode(data));
        if (dataHash != consensusHash) {
            revert UnexpectedDataHash(consensusHash, dataHash);
        }
    }

    function _handleConsensusReportData(ReportData calldata data) internal {
        DataBoundraies memory boudaries = _storageDataBoundaries().value;
        uint256 slotsElapsed = data.refSlot - LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256();

        _processStakingRouterExitedKeysByModule(
            boudaries,
            data.stakingModuleIdsWithNewlyExitedValidators,
            data.numExitedValidatorsByStakingModule,
            slotsElapsed);

        ILido(LIDO).handleOracleReport(
            slotsElapsed * SECONDS_PER_SLOT,
            data.numValidators,
            uint256(data.clBalanceGwei) * 1e9,
            data.withdrawalVaultBalance,
            data.elRewardsVaultBalance,
            data.lastWithdrawalRequestIdToFinalize,
            data.finalizationShareRate,
            data.isBunkerMode
        );

        if (data.extraDataFormat != EXTRA_DATA_FORMAT_LIST) {
            revert UnsupportedExtraDataFormat(data.extraDataFormat);
        }

        if (data.extraDataItemsCount > boudaries.maxExtraDataListItemsCount) {
            revert MaxExtraDataItemsCountExceeded(
                boudaries.maxExtraDataListItemsCount,
                data.extraDataItemsCount
            );
        }

        _storageExtraDataProcessingState().value = ExtraDataProcessingState({
            lastProcessedItem: 0,
            dataFormat: data.extraDataFormat.toUint16(),
            dataHash: data.extraDataHash,
            itemsCount: data.extraDataItemsCount.toUint16(),
            itemsProcessed: 0
        });

        emit DataSubmitted(data.refSlot);
    }

    function _processStakingRouterExitedKeysByModule(
        DataBoundraies memory boudaries,
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

        IStakingRouter stakingRouter = IStakingRouter(ILido(LIDO).getStakingRouter());

        uint256 prevExitedValidators = stakingRouter.getExitedKeysCountAcrossAllModules();
        if (exitedValidators < prevExitedValidators) {
            revert NumExitedValidatorsCannotDecrease();
        }

        uint256 exitedValidatorsPerDay =
            (exitedValidators - prevExitedValidators) * (1 days) /
            (SECONDS_PER_SLOT * slotsElapsed);

        if (exitedValidatorsPerDay > boudaries.maxExitedValidatorsPerDay) {
            revert ExitedValidatorsLimitExceeded(
                boudaries.maxExitedValidatorsPerDay,
                exitedValidatorsPerDay);
        }

        stakingRouter.updateExitedKeysCountByStakingModule(
            stakingModuleIds,
            numExitedValidatorsByStakingModule);
    }

    ///
    /// Data provider interface: extra data
    ///

    function submitReportExtraDataList(uint256[] calldata items) external {
        _checkMsgSenderIsAllowedToSubmitData();
        _checkDeadline();

        uint256 refSlot = _storageProcessingReport().value.refSlot;
        uint256 processedRefSlot = LAST_PROCESSED_REF_SLOT_POSITION.getStorageUint256();
        if (refSlot != processedRefSlot) {
            revert CannotProcessExtraDataBeforeMainData();
        }

        ExtraDataProcessingState memory procState = _storageExtraDataProcessingState().value;
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

        _procState.lastProcessedItem = _processExtraDataItems(items, 0, 0);
        _procState.itemsProcessed = uint64(items.length);

        emit ExtraDataSubmitted(refSlot, items.length, items.length);
    }

    function getExtraDataProcessingState() external view returns (
        uint256 lastProcessedItem,
        bytes32 dataHash,
        uint256 dataFormat,
        uint256 itemsCount,
        uint256 itemsProcessed
    ) {
        ExtraDataProcessingState memory state = _storageExtraDataProcessingState().value;
        lastProcessedItem = state.lastProcessedItem;
        dataHash = state.dataHash;
        dataFormat = state.dataFormat;
        itemsCount = state.itemsCount;
        itemsProcessed = state.itemsProcessed;
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
        uint256 lastProcessedItem
    ) internal returns (uint256) {
        IStakingRouter stakingRouter = IStakingRouter(ILido(LIDO).getStakingRouter());

        ExtraDataIterState memory iter = ExtraDataIterState({
            firstItemIndex: itemsProcessed,
            nextIndex: 0,
            lastType: -1,
            lastModuleId: -1,
            lastNodeOpId: -1,
            nopIds: ResizableArray.preallocate(20),
            keyCounts: ResizableArray.preallocate(20)
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
                    // TODO: report stuck validators
                    // stakingRouter.reportStakingModuleStuckKeysCountByNodeOperator(
                    //     iter.lastModuleId,
                    //     iter.nopIds.pointer(),
                    //     iter.keyCounts.pointer()
                    // );
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
    /// Storage
    ///

    struct StorageDataBoudaries {
        DataBoundraies value;
    }

    function _storageDataBoundaries() internal pure returns (StorageDataBoudaries storage r) {
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
