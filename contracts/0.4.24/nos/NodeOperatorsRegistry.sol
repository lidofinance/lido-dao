// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {AragonApp} from "@aragon/os/contracts/apps/AragonApp.sol";
import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";

import {Math64} from "../lib/Math64.sol";
import {Math256} from "../../common/lib/Math256.sol";
import {MemUtils} from "../../common/lib/MemUtils.sol";
import {MinFirstAllocationStrategy} from "../../common/lib/MinFirstAllocationStrategy.sol";
import {ILidoLocator} from "../../common/interfaces/ILidoLocator.sol";
import {IBurner} from "../../common/interfaces/IBurner.sol";
import {SigningKeys} from "../lib/SigningKeys.sol";
import {Packed64x4} from "../lib/Packed64x4.sol";
import {Versioned} from "../utils/Versioned.sol";

interface IStETH {
    function sharesOf(address _account) external view returns (uint256);
    function transferShares(address _recipient, uint256 _sharesAmount) external returns (uint256);
    function approve(address _spender, uint256 _amount) external returns (bool);
}

/// @title Node Operator registry
/// @notice Node Operator registry manages signing keys and other node operator data.
/// @dev Must implement the full version of IStakingModule interface, not only the one declared locally.
///      It's also responsible for distributing rewards to node operators.
/// NOTE: the code below assumes moderate amount of node operators, i.e. up to `MAX_NODE_OPERATORS_COUNT`.
contract NodeOperatorsRegistry is AragonApp, Versioned {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;
    using SigningKeys for bytes32;
    using Packed64x4 for Packed64x4.Packed;

    //
    // EVENTS
    //
    event NodeOperatorAdded(uint256 nodeOperatorId, string name, address rewardAddress, uint64 stakingLimit);
    event NodeOperatorActiveSet(uint256 indexed nodeOperatorId, bool active);
    event NodeOperatorNameSet(uint256 indexed nodeOperatorId, string name);
    event NodeOperatorRewardAddressSet(uint256 indexed nodeOperatorId, address rewardAddress);
    event NodeOperatorTotalKeysTrimmed(uint256 indexed nodeOperatorId, uint64 totalKeysTrimmed);
    event KeysOpIndexSet(uint256 keysOpIndex);
    event ContractVersionSet(uint256 version);
    event StakingModuleTypeSet(bytes32 moduleType);
    event RewardsDistributed(address indexed rewardAddress, uint256 sharesAmount);
    event LocatorContractSet(address locatorAddress);
    event VettedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 approvedValidatorsCount);
    event DepositedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 depositedValidatorsCount);
    event ExitedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 exitedValidatorsCount);
    event TotalSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 totalValidatorsCount);

    event NonceChanged(uint256 nonce);
    event StuckValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 stuckValidatorsCount);
    event RefundedValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 RefundedValidatorsCount);
    event TargetValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 targetValidatorsCount);
    event NodeOperatorPenalized(address indexed recipientAddress, uint256 sharesPenalizedAmount);

    //
    // ACL
    //
    // bytes32 public constant MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 public constant MANAGE_SIGNING_KEYS = 0x75abc64490e17b40ea1e66691c3eb493647b24430b358bd87ec3e5127f1621ee;
    // bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE = keccak256("SET_NODE_OPERATOR_LIMIT_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE = 0x07b39e0faf2521001ae4e58cb9ffd3840a63e205d288dc9c93c3774f0d794754;
    // bytes32 public constant ACTIVATE_NODE_OPERATOR_ROLE = keccak256("MANAGE_NODE_OPERATOR_ROLE");
    bytes32 public constant MANAGE_NODE_OPERATOR_ROLE = 0x78523850fdd761612f46e844cf5a16bda6b3151d6ae961fd7e8e7b92bfbca7f8;
    // bytes32 public constant STAKING_ROUTER_ROLE = keccak256("STAKING_ROUTER_ROLE");
    bytes32 public constant STAKING_ROUTER_ROLE = 0xbb75b874360e0bfd87f964eadd8276d8efb7c942134fc329b513032d0803e0c6;

    //
    // CONSTANTS
    //
    uint256 public constant MAX_NODE_OPERATORS_COUNT = 200;
    uint256 public constant MAX_NODE_OPERATOR_NAME_LENGTH = 255;

    uint256 internal constant UINT64_MAX = 0xFFFFFFFFFFFFFFFF;

    // SigningKeysStats
    uint8 internal constant VETTED_KEYS_COUNT_OFFSET = 0;
    /// @dev Number of keys in the EXITED state for this operator for all time
    uint8 internal constant EXITED_KEYS_COUNT_OFFSET = 1;
    /// @dev Total number of keys of this operator for all time
    uint8 internal constant TOTAL_KEYS_COUNT_OFFSET = 2;
    /// @dev Number of keys of this operator which were in DEPOSITED state for all time
    uint8 internal constant DEPOSITED_KEYS_COUNT_OFFSET = 3;

    // TargetValidatorsStats
    /// @dev DAO target limit, used to check how many keys should go to exit
    ///      UINT64_MAX - unlimited
    ///      0 - all deposited keys
    ///      N < deposited keys - (deposited-N) keys
    ///      deposited < N < vetted - use (N-deposited) as available
    uint8 internal constant IS_TARGET_LIMIT_ACTIVE_OFFSET = 0;
    /// @dev relative target active validators limit for operator, set by DAO, UINT64_MAX === 'no limit'
    /// @notice stores value +1 based, so 0 is means target count is unlimited (i.e. = -1),
    ///         and 1 is means target count = 0 (i.e. all validators should be exited)
    uint8 internal constant TARGET_VALIDATORS_COUNT_OFFSET = 1;
    /// @dev actual operators's number of keys which could be deposited
    uint8 internal constant MAX_VALIDATORS_COUNT_OFFSET = 2;

    // StuckPenaltyStats
    /// @dev stuck keys count from oracle report
    uint8 internal constant STUCK_VALIDATORS_COUNT_OFFSET = 0;
    /// @dev refunded keys count from dao
    uint8 internal constant REFUNDED_VALIDATORS_COUNT_OFFSET = 1;
    /// @dev extra penalty time after stuck keys resolved (refunded and/or exited)
    uint8 internal constant STUCK_PENALTY_END_TIMESTAMP_OFFSET = 2;

    //
    // UNSTRUCTURED STORAGE POSITIONS
    //
    // bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = keccak256("lido.NodeOperatorsRegistry.signingKeysMappingName");
    bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = 0xeb2b7ad4d8ce5610cfb46470f03b14c197c2b751077c70209c5d0139f7c79ee9;

    // bytes32 internal constant LIDO_LOCATOR_POSITION = keccak256("lido.NodeOperatorsRegistry.lidoLocator");
    bytes32 internal constant LIDO_LOCATOR_POSITION = 0xfb2059fd4b64256b64068a0f57046c6d40b9f0e592ba8bcfdf5b941910d03537;

    /// @dev Total number of operators
    // bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.totalOperatorsCount");
    bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION =
        0xe2a589ae0816b289a9d29b7c085f8eba4b5525accca9fa8ff4dba3f5a41287e8;

    /// @dev Cached number of active operators
    // bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.activeOperatorsCount");
    bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION =
        0x6f5220989faafdc182d508d697678366f4e831f5f56166ad69bfc253fc548fb1;

    /// @dev link to the index of operations with keys
    // bytes32 internal constant KEYS_OP_INDEX_POSITION = keccak256("lido.NodeOperatorsRegistry.keysOpIndex");
    bytes32 internal constant KEYS_OP_INDEX_POSITION = 0xcd91478ac3f2620f0776eacb9c24123a214bcb23c32ae7d28278aa846c8c380e;

    /// @dev module type
    // bytes32 internal constant TYPE_POSITION = keccak256("lido.NodeOperatorsRegistry.type");
    bytes32 internal constant TYPE_POSITION = 0xbacf4236659a602d72c631ba0b0d67ec320aaf523f3ae3590d7faee4f42351d0;

    // bytes32 internal constant TYPE_POSITION = keccak256("lido.NodeOperatorsRegistry.stuckPenaltyDelay");
    bytes32 internal constant STUCK_PENALTY_DELAY_POSITION = 0x8e3a1f3826a82c1116044b334cae49f3c3d12c3866a1c4b18af461e12e58a18e;

    //
    // DATA TYPES
    //

    /// @dev Node Operator parameters and internal state
    struct NodeOperator {
        /// @dev Flag indicating if the operator can participate in further staking and reward distribution
        bool active;
        /// @dev Ethereum address on Execution Layer which receives stETH rewards for this operator
        address rewardAddress;
        /// @dev Human-readable name
        string name;
        /// @dev The below variables store the signing keys info of the node operator.
        ///     signingKeysStats - contains packed variables: uint64 exitedSigningKeysCount, uint64 depositedSigningKeysCount,
        ///                        uint64 vettedSigningKeysCount, uint64 totalSigningKeysCount
        ///
        ///     These variables can take values in the following ranges:
        ///
        ///                0             <=  exitedSigningKeysCount   <= depositedSigningKeysCount
        ///     exitedSigningKeysCount   <= depositedSigningKeysCount <=  vettedSigningKeysCount
        ///    depositedSigningKeysCount <=   vettedSigningKeysCount  <=   totalSigningKeysCount
        ///    depositedSigningKeysCount <=   totalSigningKeysCount   <=        MAX_UINT64
        ///
        /// Additionally, the exitedSigningKeysCount and depositedSigningKeysCount values are monotonically increasing:
        /// :                              :         :         :         :
        /// [....exitedSigningKeysCount....]-------->:         :         :
        /// [....depositedSigningKeysCount :.........]-------->:         :
        /// [....vettedSigningKeysCount....:.........:<--------]-------->:
        /// [....totalSigningKeysCount.....:.........:<--------:---------]------->
        /// :                              :         :         :         :
        Packed64x4.Packed signingKeysStats;
        Packed64x4.Packed stuckPenaltyStats;
        Packed64x4.Packed targetValidatorsStats;
    }

    struct NodeOperatorTotals {
        Packed64x4.Packed signingKeysStats;
        // Packed64x4.Packed targetValidatorsStats;
    }

    //
    // STORAGE VARIABLES
    //

    /// @dev Mapping of all node operators. Mapping is used to be able to extend the struct.
    mapping(uint256 => NodeOperator) internal _nodeOperators;
    NodeOperatorTotals internal _nodeOperatorTotals;

    //
    // METHODS
    //
    function initialize(address _locator, bytes32 _type) public onlyInit {
        // Initializations for v1 --> v2
        _initialize_v2(_locator, _type);
        initialized();
    }

    /// @notice A function to finalize upgrade to v2 (from v1). Can be called only once
    /// For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
    function finalizeUpgrade_v2(address _locator, bytes32 _type) external {
        require(hasInitialized() && !isPetrified(), "CONTRACT_NOT_INITIALIZED_OR_PETRIFIED");
        _checkContractVersion(0);
        _initialize_v2(_locator, _type);

        uint256 totalOperators = getNodeOperatorsCount();
        Packed64x4.Packed memory signingKeysStats;
        Packed64x4.Packed memory operatorTargetStats;
        Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
        uint64 vettedSigningKeysCountBefore;
        uint64 totalSigningKeysCount;
        uint64 depositedSigningKeysCount;
        for (uint256 nodeOperatorId; nodeOperatorId < totalOperators; ++nodeOperatorId) {
            signingKeysStats = _loadOperatorSigningKeysStats(nodeOperatorId);
            vettedSigningKeysCountBefore = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
            totalSigningKeysCount = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
            depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);

            uint64 vettedSigningKeysCountAfter;
            if (!_nodeOperators[nodeOperatorId].active) {
                // trim vetted signing keys count when node operator is not active
                vettedSigningKeysCountAfter = depositedSigningKeysCount;
            } else {
                vettedSigningKeysCountAfter =
                    Math64.min(totalSigningKeysCount, Math64.max(depositedSigningKeysCount, vettedSigningKeysCountBefore));
            }

            if (vettedSigningKeysCountBefore != vettedSigningKeysCountAfter) {
                signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCountAfter);
                _saveOperatorSigningKeysStats(nodeOperatorId, signingKeysStats);

                operatorTargetStats = _loadOperatorTargetValidatorsStats(nodeOperatorId);
                operatorTargetStats.set(MAX_VALIDATORS_COUNT_OFFSET, vettedSigningKeysCountAfter);
                _saveOperatorTargetValidatorsStats(nodeOperatorId, operatorTargetStats);

                emit VettedSigningKeysCountChanged(nodeOperatorId, vettedSigningKeysCountAfter);
            }

            totalSigningKeysStats.set(
                VETTED_KEYS_COUNT_OFFSET, totalSigningKeysStats.get(VETTED_KEYS_COUNT_OFFSET).add(vettedSigningKeysCountAfter)
            );
            totalSigningKeysStats.set(
                DEPOSITED_KEYS_COUNT_OFFSET,
                totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET).add(depositedSigningKeysCount)
            );
            totalSigningKeysStats.set(
                EXITED_KEYS_COUNT_OFFSET,
                totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET).add(signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET))
            );
            totalSigningKeysStats.set(
                TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysStats.get(TOTAL_KEYS_COUNT_OFFSET).add(totalSigningKeysCount)
            );
        }

        _saveTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    function _initialize_v2(address _locator, bytes32 _type) internal {
        _onlyNonZeroAddress(_locator);
        LIDO_LOCATOR_POSITION.setStorageAddress(_locator);
        TYPE_POSITION.setStorageBytes32(_type);

        _setContractVersion(2);

        _setStuckPenaltyDelay(2 days);

        // set unlimited allowance for burner from staking router
        // to burn stuck keys penalized shares
        IStETH(getLocator().lido()).approve(getLocator().burner(), ~uint256(0));

        emit ContractVersionSet(2);
        emit LocatorContractSet(_locator);
        emit StakingModuleTypeSet(_type);
    }

    /// @notice Add node operator named `name` with reward address `rewardAddress` and staking limit = 0 validators
    /// @param _name Human-readable name
    /// @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
    /// @return id a unique key of the added operator
    function addNodeOperator(string _name, address _rewardAddress) external returns (uint256 id) {
        _onlyValidNodeOperatorName(_name);
        _onlyNonZeroAddress(_rewardAddress);
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        id = getNodeOperatorsCount();
        require(id < MAX_NODE_OPERATORS_COUNT, "MAX_OPERATORS_COUNT_EXCEEDED");

        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(id + 1);

        NodeOperator storage operator = _nodeOperators[id];

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount + 1);

        operator.active = true;
        operator.name = _name;
        operator.rewardAddress = _rewardAddress;

        emit NodeOperatorAdded(id, _name, _rewardAddress, 0);
    }

    /// @notice Activates deactivated node operator with given id
    /// @param _nodeOperatorId Node operator id to deactivate
    function activateNodeOperator(uint256 _nodeOperatorId) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        _onlyCorrectNodeOperatorState(!getNodeOperatorIsActive(_nodeOperatorId));

        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(getActiveNodeOperatorsCount() + 1);

        _nodeOperators[_nodeOperatorId].active = true;

        emit NodeOperatorActiveSet(_nodeOperatorId, true);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Deactivates active node operator with given id
    /// @param _nodeOperatorId Node operator id to deactivate
    function deactivateNodeOperator(uint256 _nodeOperatorId) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        _onlyCorrectNodeOperatorState(getNodeOperatorIsActive(_nodeOperatorId));

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.sub(1));

        _nodeOperators[_nodeOperatorId].active = false;

        emit NodeOperatorActiveSet(_nodeOperatorId, false);

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        uint64 vettedSigningKeysCount = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
        uint64 depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);

        // reset vetted keys count to the deposited validators count
        if (vettedSigningKeysCount > depositedSigningKeysCount) {
            signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
            _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);

            emit VettedSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);

            _updateTotalMaxValidatorsCount(_nodeOperatorId);
        }
        _increaseValidatorsKeysNonce();
    }

    /// @notice Change human-readable name of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set name for
    /// @param _name New human-readable name of the node operator
    function setNodeOperatorName(uint256 _nodeOperatorId, string _name) external {
        _onlyValidNodeOperatorName(_name);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        _requireNotSameValue(keccak256(bytes(_nodeOperators[_nodeOperatorId].name)) != keccak256(bytes(_name)));
        _nodeOperators[_nodeOperatorId].name = _name;
        emit NodeOperatorNameSet(_nodeOperatorId, _name);
    }

    /// @notice Change reward address of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _rewardAddress Execution layer Ethereum address to set as reward address
    function setNodeOperatorRewardAddress(uint256 _nodeOperatorId, address _rewardAddress) external {
        _onlyNonZeroAddress(_rewardAddress);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        _requireNotSameValue(_nodeOperators[_nodeOperatorId].rewardAddress != _rewardAddress);
        _nodeOperators[_nodeOperatorId].rewardAddress = _rewardAddress;
        emit NodeOperatorRewardAddressSet(_nodeOperatorId, _rewardAddress);
    }

    /// @notice Set the maximum number of validators to stake for the node operator with given id
    /// @dev Current implementation preserves invariant: depositedSigningKeysCount <= vettedSigningKeysCount <= totalSigningKeysCount.
    ///     If _vettedSigningKeysCount out of range [depositedSigningKeysCount, totalSigningKeysCount], the new vettedSigningKeysCount
    ///     value will be set to the nearest range border.
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _vettedSigningKeysCount New staking limit of the node operator
    function setNodeOperatorStakingLimit(uint256 _nodeOperatorId, uint64 _vettedSigningKeysCount) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _authP(SET_NODE_OPERATOR_LIMIT_ROLE, arr(uint256(_nodeOperatorId), uint256(_vettedSigningKeysCount)));
        _onlyCorrectNodeOperatorState(getNodeOperatorIsActive(_nodeOperatorId));

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        uint64 vettedSigningKeysCountBefore = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
        uint64 depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        uint64 totalSigningKeysCount = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);

        uint64 vettedSigningKeysCountAfter =
            Math64.min(totalSigningKeysCount, Math64.max(_vettedSigningKeysCount, depositedSigningKeysCount));

        if (vettedSigningKeysCountAfter == vettedSigningKeysCountBefore) {
            return;
        }

        signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCountAfter);
        _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);

        emit VettedSigningKeysCountChanged(_nodeOperatorId, vettedSigningKeysCountAfter);

        _updateTotalMaxValidatorsCount(_nodeOperatorId);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Called by StakingRouter to signal that stETH rewards were minted for this module.
    function handleRewardsMinted(uint256) external view {
        _auth(STAKING_ROUTER_ROLE);
        // since we're pushing rewards to operators after exited validators counts are
        // updated (as opposed to pulling by node ops), we don't need any handling here
        // see `onAllValidatorCountersUpdated()`
    }

    /// @notice Called by StakingRouter to update the number of the validators of the given node
    /// operator that were requested to exit but failed to do so in the max allowed time
    ///
    /// @param _nodeOperatorId Id of the node operator
    /// @param _stuckValidatorsCount New number of stuck validators of the node operator
    function updateStuckValidatorsCount(uint256 _nodeOperatorId, uint256 _stuckValidatorsCount) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        _updateStuckValidatorsCount(_nodeOperatorId, uint64(_stuckValidatorsCount));
    }

    /// @notice Called by StakingRouter to update the number of the validators in the EXITED state
    /// for node operator with given id
    ///
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsCount New number of EXITED validators of the node operator
    function updateExitedValidatorsCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsCount)
        external
    {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        _updateExitedValidatorsCount(_nodeOperatorId, uint64(_exitedValidatorsCount), false);
    }

    /// @notice Updates the number of the refunded validators for node operator with the given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _refundedValidatorsCount New number of refunded validators of the node operator
    function updateRefundedValidatorsCount(uint256 _nodeOperatorId, uint256 _refundedValidatorsCount) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        _updateRefundValidatorsKeysCount(_nodeOperatorId, uint64(_refundedValidatorsCount));
    }

    /// @notice Called by StakingRouter after oracle finishes updating validators counters for all node operators
    function onAllValidatorCountersUpdated() external
    {
        _auth(STAKING_ROUTER_ROLE);
        // for the permissioned module, we're distributing rewards within oracle operation
        // since the number of node ops won't be high and thus gas costs are limited
        _distributeRewards();
    }

    /// @notice Unsafely updates the number of validators in the EXITED/STUCK states for node operator with given id
    ///      'unsafely' means that this method can both increase and decrease exited and stuck counters
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsCount New number of EXITED validators for the node operator
    /// @param _stuckValidatorsCount New number of STUCK validator for the node operator
    function unsafeUpdateValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsCount,
        uint256 _stuckValidatorsCount
    ) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        _updateExitedValidatorsCount(_nodeOperatorId, uint64(_exitedValidatorsCount), true /* _allowDecrease */);
        _updateStuckValidatorsCount(_nodeOperatorId, uint64(_stuckValidatorsCount));
    }

    function _updateExitedValidatorsCount(uint256 _nodeOperatorId, uint64 _exitedValidatorsKeysCount, bool _allowDecrease)
        internal
    {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        int64 totalExitedValidatorsDelta =
            int64(_exitedValidatorsKeysCount) - int64(signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET));

        if (totalExitedValidatorsDelta != 0) {
            _requireValidRange(_exitedValidatorsKeysCount <= signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET));
            if (totalExitedValidatorsDelta < 0 && !_allowDecrease) {
                revert("EXITED_VALIDATORS_COUNT_DECREASED");
            }

            signingKeysStats.set(EXITED_KEYS_COUNT_OFFSET, _exitedValidatorsKeysCount);
            _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);
            emit ExitedSigningKeysCountChanged(_nodeOperatorId, _exitedValidatorsKeysCount);

            // upd totals
            Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
            totalSigningKeysStats.set(
                EXITED_KEYS_COUNT_OFFSET,
                uint64(int64(totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET)) + totalExitedValidatorsDelta)
            );
            _saveTotalSigningKeysStats(totalSigningKeysStats);

            /// @todo optimize: reuse totalSigningKeysStats
            _updateTotalMaxValidatorsCount(_nodeOperatorId);
        }
    }

    /// @notice Updates the limit of the validators that can be used for deposit by DAO
    /// @param _nodeOperatorId Id of the node operator
    /// @param _targetLimit Target limit of the node operator
    /// @param _isTargetLimitActive active flag
    function updateTargetValidatorsLimits(uint256 _nodeOperatorId, bool _isTargetLimitActive, uint64 _targetLimit) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);
        operatorTargetStats.set(IS_TARGET_LIMIT_ACTIVE_OFFSET, _isTargetLimitActive ? 1 : 0);
        operatorTargetStats.set(TARGET_VALIDATORS_COUNT_OFFSET, _isTargetLimitActive ? _targetLimit : 0);
        _saveOperatorTargetValidatorsStats(_nodeOperatorId, operatorTargetStats);

        emit TargetValidatorsCountChanged(_nodeOperatorId, _targetLimit);

        _updateTotalMaxValidatorsCount(_nodeOperatorId);
    }

    /**
     * @notice Set the stuck signings keys count
     */
    function _updateStuckValidatorsCount(uint256 _nodeOperatorId, uint64 _stuckValidatorsCount) internal {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        if (_stuckValidatorsCount == stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET)) return;

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        _requireValidRange(_stuckValidatorsCount <= signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET));

        stuckPenaltyStats.set(STUCK_VALIDATORS_COUNT_OFFSET, _stuckValidatorsCount);
        if (_stuckValidatorsCount <= stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET)) {
            stuckPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, uint64(block.timestamp + getStuckPenaltyDelay()));
        }
        _saveOperatorStuckPenaltyStats(_nodeOperatorId, stuckPenaltyStats);
        emit StuckValidatorsCountChanged(_nodeOperatorId, _stuckValidatorsCount);

        _updateTotalMaxValidatorsCount(_nodeOperatorId);
    }

    function _updateRefundValidatorsKeysCount(uint256 _nodeOperatorId, uint64 _refundedValidatorsCount) internal {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        if (_refundedValidatorsCount == stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET)) return;

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        _requireValidRange(_refundedValidatorsCount <= signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET));

        stuckPenaltyStats.set(REFUNDED_VALIDATORS_COUNT_OFFSET, _refundedValidatorsCount);
        if (stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET) <= _refundedValidatorsCount) {
            stuckPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, uint64(block.timestamp + getStuckPenaltyDelay()));
        }
        _saveOperatorStuckPenaltyStats(_nodeOperatorId, stuckPenaltyStats);
        emit RefundedValidatorsCountChanged(_nodeOperatorId, _refundedValidatorsCount);

        _updateTotalMaxValidatorsCount(_nodeOperatorId);
    }

    // upd op limits and totals
    function _updateTotalMaxValidatorsCount(uint256 _nodeOperatorId) internal returns (int64 maxSigningKeysDelta) {
        maxSigningKeysDelta = _applyNodeOperatorLimits(_nodeOperatorId);
        if (maxSigningKeysDelta != 0) {
            Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();

            totalSigningKeysStats.set(
                VETTED_KEYS_COUNT_OFFSET,
                uint64(int64(totalSigningKeysStats.get(VETTED_KEYS_COUNT_OFFSET)) + maxSigningKeysDelta)
            );
            _saveTotalSigningKeysStats(totalSigningKeysStats);
        }
    }

    /// @notice Invalidates all unused deposit data for all node operators
    function onWithdrawalCredentialsChanged() external {
        uint256 operatorsCount = getNodeOperatorsCount();
        if (operatorsCount > 0) {
            invalidateReadyToDepositKeysRange(0, operatorsCount - 1);
        }
    }

    /// @notice Invalidates all unused validators keys for all node operators
    function invalidateReadyToDepositKeysRange(uint256 _indexFrom, uint256 _indexTo) public {
        _auth(MANAGE_NODE_OPERATOR_ROLE);
        _requireValidRange(_indexFrom <= _indexTo && _indexTo < getNodeOperatorsCount());

        uint64 trimmedKeysCount;
        uint64 totalTrimmedKeysCount;
        Packed64x4.Packed memory signingKeysStats;

        for (uint256 nodeOperatorId = _indexFrom; nodeOperatorId <= _indexTo; ++nodeOperatorId) {
            signingKeysStats = _loadOperatorSigningKeysStats(nodeOperatorId);

            uint64 depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
            trimmedKeysCount = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET) - depositedSigningKeysCount;
            if (trimmedKeysCount == 0) continue;
            totalTrimmedKeysCount += trimmedKeysCount;

            signingKeysStats.set(TOTAL_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
            signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
            _saveOperatorSigningKeysStats(nodeOperatorId, signingKeysStats);

            _updateTotalMaxValidatorsCount(nodeOperatorId);

            emit TotalSigningKeysCountChanged(nodeOperatorId, depositedSigningKeysCount);
            emit VettedSigningKeysCountChanged(nodeOperatorId, depositedSigningKeysCount);
            emit NodeOperatorTotalKeysTrimmed(nodeOperatorId, trimmedKeysCount);
        }

        if (totalTrimmedKeysCount > 0) {
            _increaseValidatorsKeysNonce();
        }
    }

    /// @notice Obtains up to _depositsCount deposit data to be used by StakingRouter
    ///     to deposit to the Ethereum Deposit contract
    /// @dev the second param is optional staking module calldata
    ///     (not used for NodeOperatorsRegistry)
    /// @param _depositsCount Desireable number of deposits to be done
    /// @return depositsCount Actual deposits count might be done with returned data
    /// @return publicKeys Batch of the concatenated public validators keys
    /// @return signatures Batch of the concatenated deposit signatures for returned public keys
    function obtainDepositData(uint256 _depositsCount, bytes /* _depositCalldata */)
        external
        returns (
            uint256 depositsCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        _auth(STAKING_ROUTER_ROLE);

        uint256[] memory nodeOperatorIds;
        uint256[] memory activeKeysCountAfterAllocation;

        (depositsCount, nodeOperatorIds, activeKeysCountAfterAllocation) =
            _getSigningKeysAllocationData(_depositsCount);

        if (depositsCount == 0) {
            return (0, new bytes(0), new bytes(0));
        }

        (publicKeys, signatures) =
            _loadAllocatedSigningKeys(depositsCount, nodeOperatorIds, activeKeysCountAfterAllocation);
        _increaseValidatorsKeysNonce();
    }

    function _getNodeOperatorWithLimitApplied(uint256 _nodeOperatorId)
        internal
        view
        returns (uint64 maxSigningKeysCount, uint64 exitedSigningKeysCount, uint64 depositedSigningKeysCount)
    {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);

        exitedSigningKeysCount = signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
        depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        maxSigningKeysCount = operatorTargetStats.get(MAX_VALIDATORS_COUNT_OFFSET);
    }

    function _applyNodeOperatorLimits(uint256 _nodeOperatorId) internal returns (int64 maxSigningKeysDelta) {
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);

        uint64 exitedSigningKeysCount = signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
        uint64 depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        uint64 vettedSigningKeysCount = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);

        /// @todo check for MAX_VALIDATORS_COUNT_OFFSET < MAX_UINT64 - 1
        uint64 oldMaxSigningKeysCount = operatorTargetStats.get(MAX_VALIDATORS_COUNT_OFFSET);
        uint64 newMaxSigningKeysCount = depositedSigningKeysCount;

        if (!isOperatorPenalized(_nodeOperatorId, true)) {
            if (operatorTargetStats.get(IS_TARGET_LIMIT_ACTIVE_OFFSET) == 0) {
                newMaxSigningKeysCount = vettedSigningKeysCount;
            } else {
                // correct max count according to target if target is enabled
                uint64 targetLimit = exitedSigningKeysCount.add(operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET));
                if (targetLimit > depositedSigningKeysCount) {
                    newMaxSigningKeysCount = Math64.min(vettedSigningKeysCount, targetLimit);
                }
            }
        } // else newMaxSigningKeysCount = depositedSigningKeysCount, so depositable keys count = 0

        if (oldMaxSigningKeysCount != newMaxSigningKeysCount) {
            operatorTargetStats.set(MAX_VALIDATORS_COUNT_OFFSET, newMaxSigningKeysCount);
            _saveOperatorTargetValidatorsStats(_nodeOperatorId, operatorTargetStats);
            maxSigningKeysDelta = int64(newMaxSigningKeysCount) - int64(oldMaxSigningKeysCount);
        }
    }

    function _getSigningKeysAllocationData(uint256 _keysCount)
        internal
        view
        returns (uint256 allocatedKeysCount, uint256[] memory nodeOperatorIds, uint256[] memory activeKeyCountsAfterAllocation)
    {
        uint256 activeNodeOperatorsCount = getActiveNodeOperatorsCount();
        nodeOperatorIds = new uint256[](activeNodeOperatorsCount);
        activeKeyCountsAfterAllocation = new uint256[](activeNodeOperatorsCount);
        uint256[] memory activeKeysCapacities = new uint256[](activeNodeOperatorsCount);

        uint256 activeNodeOperatorIndex;
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        uint256 maxSigningKeysCount;
        uint256 depositedSigningKeysCount;
        uint256 exitedSigningKeysCount;

        /// @todo check for MAX_VALIDATORS_COUNT_OFFSET < MAX_UINT64 - 1

        for (uint256 nodeOperatorId; nodeOperatorId < nodeOperatorsCount; ++nodeOperatorId) {
            (maxSigningKeysCount, exitedSigningKeysCount, depositedSigningKeysCount) =
                _getNodeOperatorWithLimitApplied(nodeOperatorId);

            // the node operator has no available signing keys
            if (depositedSigningKeysCount == maxSigningKeysCount) continue;

            nodeOperatorIds[activeNodeOperatorIndex] = nodeOperatorId;
            activeKeyCountsAfterAllocation[activeNodeOperatorIndex] = depositedSigningKeysCount - exitedSigningKeysCount;
            activeKeysCapacities[activeNodeOperatorIndex] = maxSigningKeysCount - exitedSigningKeysCount;
            ++activeNodeOperatorIndex;
        }

        if (activeNodeOperatorIndex == 0) return (0, new uint256[](0), new uint256[](0));

        /// @dev shrink the length of the resulting arrays if some active node operators have no available keys to be deposited
        if (activeNodeOperatorIndex < activeNodeOperatorsCount) {
            assembly {
                mstore(nodeOperatorIds, activeNodeOperatorIndex)
                mstore(activeKeyCountsAfterAllocation, activeNodeOperatorIndex)
                mstore(activeKeysCapacities, activeNodeOperatorIndex)
            }
        }

        allocatedKeysCount =
            MinFirstAllocationStrategy.allocate(activeKeyCountsAfterAllocation, activeKeysCapacities, uint64(_keysCount));

        assert(allocatedKeysCount <= _keysCount);
    }

    function _loadAllocatedSigningKeys(
        uint256 _keysCountToLoad,
        uint256[] memory _nodeOperatorIds,
        uint256[] memory _activeKeyCountsAfterAllocation
    ) internal returns (bytes memory pubkeys, bytes memory signatures) {
        (pubkeys, signatures) = SigningKeys.initKeySig(_keysCountToLoad);

        uint256 loadedKeysCount = 0;
        uint64 depositedSigningKeysCountBefore;
        uint64 depositedSigningKeysCountAfter;
        uint256 keyIndex;
        Packed64x4.Packed memory signingKeysStats;
        for (uint256 i; i < _nodeOperatorIds.length; ++i) {
            signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorIds[i]);
            depositedSigningKeysCountBefore = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
            depositedSigningKeysCountAfter =
                signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET) + uint64(_activeKeyCountsAfterAllocation[i]);

            if (depositedSigningKeysCountBefore == depositedSigningKeysCountAfter) continue;

            for (keyIndex = depositedSigningKeysCountBefore; keyIndex < depositedSigningKeysCountAfter; ++keyIndex) {
                SIGNING_KEYS_MAPPING_NAME.loadKeySigAndAppend(
                    _nodeOperatorIds[i], keyIndex, loadedKeysCount, pubkeys, signatures
                );
                ++loadedKeysCount;
            }
            emit DepositedSigningKeysCountChanged(_nodeOperatorIds[i], depositedSigningKeysCountAfter);
            signingKeysStats.set(DEPOSITED_KEYS_COUNT_OFFSET, depositedSigningKeysCountAfter);
            _saveOperatorSigningKeysStats(_nodeOperatorIds[i], signingKeysStats);
            _updateTotalMaxValidatorsCount(_nodeOperatorIds[i]);
        }

        assert(loadedKeysCount == _keysCountToLoad);

        Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
        totalSigningKeysStats.set(
            DEPOSITED_KEYS_COUNT_OFFSET, totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET).add(uint64(loadedKeysCount))
        );
        _saveTotalSigningKeysStats(totalSigningKeysStats);
    }

    /// @notice Returns the node operator by id
    /// @param _nodeOperatorId Node Operator id
    /// @param _fullInfo If true, name will be returned as well
    function getNodeOperator(uint256 _nodeOperatorId, bool _fullInfo)
        external
        view
        returns (
            bool active,
            string name,
            address rewardAddress,
            uint64 stakingLimit,
            uint64 stoppedValidators,
            uint64 totalSigningKeys,
            uint64 usedSigningKeys
        )
    {
        _onlyExistedNodeOperator(_nodeOperatorId);

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        active = nodeOperator.active;
        rewardAddress = nodeOperator.rewardAddress;
        name = _fullInfo ? nodeOperator.name : ""; // reading name is 2+ SLOADs

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);

        stakingLimit = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
        stoppedValidators = signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
        totalSigningKeys = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
        usedSigningKeys = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
    }

    /// @notice Returns the rewards distribution proportional to the effective stake for each node operator.
    /// @param _totalRewardShares Total amount of reward shares to distribute.
    function getRewardsDistribution(uint256 _totalRewardShares)
        public
        view
        returns (address[] memory recipients, uint256[] memory shares, bool[] memory penalized)
    {
        uint256 nodeOperatorCount = getNodeOperatorsCount();

        uint256 activeCount = getActiveNodeOperatorsCount();
        recipients = new address[](activeCount);
        shares = new uint256[](activeCount);
        penalized = new bool[](activeCount);
        uint256 idx = 0;

        uint256 totalActiveValidatorsCount = 0;
        for (uint256 operatorId; operatorId < nodeOperatorCount; ++operatorId) {
            if (!getNodeOperatorIsActive(operatorId)) continue;

            Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(operatorId);
            uint256 activeValidatorsCount =
                signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET) - signingKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
            totalActiveValidatorsCount = totalActiveValidatorsCount.add(activeValidatorsCount);

            recipients[idx] = _nodeOperators[operatorId].rewardAddress;
            // prefill shares array with 'key share' for recipient, see below
            shares[idx] = activeValidatorsCount;
            penalized[idx] = isOperatorPenalized(operatorId, false);

            ++idx;
        }

        if (totalActiveValidatorsCount == 0) return (recipients, shares, penalized);

        uint256 perValidatorReward = _totalRewardShares.div(totalActiveValidatorsCount);

        for (idx = 0; idx < activeCount; ++idx) {
            shares[idx] = shares[idx].mul(perValidatorReward);
        }

        return (recipients, shares, penalized);
    }

    /// @notice Add `_quantity` validator signing keys to the keys of the node operator #`_nodeOperatorId`. Concatenated keys are: `_pubkeys`
    /// @dev Along with each key the DAO has to provide a signatures for the
    ///      (pubkey, withdrawal_credentials, 32000000000) message.
    ///      Given that information, the contract'll be able to call
    ///      deposit_contract.deposit on-chain.
    /// @param _nodeOperatorId Node Operator id
    /// @param _keysCount Number of signing keys provided
    /// @param _publicKeys Several concatenated validator signing keys
    /// @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
    function addSigningKeys(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures) external {
        _addSigningKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    /// @notice Add `_quantity` validator signing keys of operator #`_id` to the set of usable keys. Concatenated keys are: `_pubkeys`. Can be done by node operator in question by using the designated rewards address.
    /// @dev Along with each key the DAO has to provide a signatures for the
    ///      (pubkey, withdrawal_credentials, 32000000000) message.
    ///      Given that information, the contract'll be able to call
    ///      deposit_contract.deposit on-chain.
    /// @param _nodeOperatorId Node Operator id
    /// @param _keysCount Number of signing keys provided
    /// @param _publicKeys Several concatenated validator signing keys
    /// @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
    /// @dev DEPRECATED use addSigningKeys instead
    function addSigningKeysOperatorBH(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures)
        external
    {
        _addSigningKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    function _addSigningKeys(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures) internal {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        _requireValidRange(_keysCount != 0 && _keysCount <= UINT64_MAX);

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        uint256 totalSigningKeysCount = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);

        _requireValidRange(totalSigningKeysCount.add(_keysCount) <= UINT64_MAX);

        //
        totalSigningKeysCount =
            SIGNING_KEYS_MAPPING_NAME.addKeysSigs(_nodeOperatorId, _keysCount, totalSigningKeysCount, _publicKeys, _signatures);

        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount);

        signingKeysStats.set(TOTAL_KEYS_COUNT_OFFSET, uint64(totalSigningKeysCount));
        _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);

        // upd totals
        Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
        totalSigningKeysStats.set(
            TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysStats.get(TOTAL_KEYS_COUNT_OFFSET).add(uint64(_keysCount))
        );
        _saveTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    /// @notice Removes a validator signing key #`_index` from the keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKey(uint256 _nodeOperatorId, uint256 _index) external {
        _removeUnusedSigningKeys(_nodeOperatorId, _index, 1);
    }

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    function removeSigningKeys(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) external {
        _removeUnusedSigningKeys(_nodeOperatorId, _fromIndex, _keysCount);
    }

    /// @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKeyOperatorBH(uint256 _nodeOperatorId, uint256 _index) external {
        _removeUnusedSigningKeys(_nodeOperatorId, _index, 1);
    }

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKeysOperatorBH(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) external {
        _removeUnusedSigningKeys(_nodeOperatorId, _fromIndex, _keysCount);
    }

    function _removeUnusedSigningKeys(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) internal {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        // preserve the previous behavior of the method here and just return earlier
        if (_keysCount == 0) return;

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        uint256 totalSigningKeysCount = signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
        uint256 _toIndex = _fromIndex.add(_keysCount);
        // comapring _toIndex <= totalSigningKeysCount is enough as totalSigningKeysCount is always less than MAX_UINT64
        _requireValidRange(_fromIndex >= signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET) && _toIndex <= totalSigningKeysCount);

        /// @todo: move to lib
        // removing from the last index to the highest one, so we won't get outside the array
        for (uint256 i = _toIndex; i > _fromIndex; --i) {
            totalSigningKeysCount =
                SIGNING_KEYS_MAPPING_NAME.removeUnusedKeySig(_nodeOperatorId, i - 1, totalSigningKeysCount.sub(1));
        }
        signingKeysStats.set(TOTAL_KEYS_COUNT_OFFSET, uint64(totalSigningKeysCount));
        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount);

        uint64 vettedSigningKeysCount = signingKeysStats.get(VETTED_KEYS_COUNT_OFFSET);
        if (_fromIndex < vettedSigningKeysCount) {
            // decreasing the staking limit so the key at _index can't be used anymore
            signingKeysStats.set(VETTED_KEYS_COUNT_OFFSET, uint64(_fromIndex));
            emit VettedSigningKeysCountChanged(_nodeOperatorId, _fromIndex);
        }
        _saveOperatorSigningKeysStats(_nodeOperatorId, signingKeysStats);

        // upd totals
        Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
        totalSigningKeysStats.set(
            TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysStats.get(TOTAL_KEYS_COUNT_OFFSET).sub(uint64(_keysCount))
        );
        _saveTotalSigningKeysStats(totalSigningKeysStats);
        /// @todo optimize: reuse totalSigningKeysStats
        _updateTotalMaxValidatorsCount(_nodeOperatorId);

        _increaseValidatorsKeysNonce();
    }

    /// @notice Returns total number of signing keys of the node operator #`_nodeOperatorId`
    function getTotalSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET);
    }

    /// @notice Returns number of usable signing keys of the node operator #`_nodeOperatorId`
    function getUnusedSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        return signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET) - signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
    }

    /// @notice Returns n-th signing key of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @return key Key
    /// @return depositSignature Signature needed for a deposit_contract.deposit call
    /// @return used Flag indication if the key was used in the staking
    function getSigningKey(uint256 _nodeOperatorId, uint256 _index)
        external
        view
        returns (bytes key, bytes depositSignature, bool used)
    {
        bool[] memory keyUses;
        (key, depositSignature, keyUses) = getSigningKeys(_nodeOperatorId, _index, 1);
        used = keyUses[0];
    }

    /// @notice Returns n signing keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _offset Offset of the key, starting with 0
    /// @param _limit Number of keys to return
    /// @return pubkeys Keys concatenated into the bytes batch
    /// @return signatures Signatures concatenated into the bytes batch needed for a deposit_contract.deposit call
    /// @return used Array of flags indicated if the key was used in the staking
    function getSigningKeys(uint256 _nodeOperatorId, uint256 _offset, uint256 _limit)
        public
        view
        returns (bytes memory pubkeys, bytes memory signatures, bool[] memory used)
    {
        _onlyExistedNodeOperator(_nodeOperatorId);

        Packed64x4.Packed memory signingKeysStats = _loadOperatorSigningKeysStats(_nodeOperatorId);
        _requireValidRange(_offset.add(_limit) <= signingKeysStats.get(TOTAL_KEYS_COUNT_OFFSET));

        uint256 depositedSigningKeysCount = signingKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        (pubkeys, signatures) = SigningKeys.initKeySig(_limit);
        used = new bool[](_limit);

        for (uint256 i; i < _limit; ++i) {
            SIGNING_KEYS_MAPPING_NAME.loadKeySigAndAppend(_nodeOperatorId, _offset + i, i, pubkeys, signatures);
            used[i] = (_offset + i) < depositedSigningKeysCount;
        }
    }

    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32) {
        return TYPE_POSITION.getStorageBytes32();
    }

    function getStakingModuleSummary()
        external
        view
        returns (uint256 totalExitedValidators, uint256 totalDepositedValidators, uint256 depositableValidatorsCount)
    {
        Packed64x4.Packed memory totalSigningKeysStats = _loadTotalSigningKeysStats();
        totalExitedValidators = totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
        totalDepositedValidators = totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET);
        depositableValidatorsCount = totalSigningKeysStats.get(VETTED_KEYS_COUNT_OFFSET) - totalDepositedValidators;
    }

    function getNodeOperatorSummary(uint256 _nodeOperatorId) external view returns (
            bool isTargetLimitActive,
            uint256 targetValidatorsCount,
            uint256 stuckValidatorsCount,
            uint256 refundedValidatorsCount,
            uint256 stuckPenaltyEndTimestamp,
            uint256 totalExitedValidators,
            uint256 totalDepositedValidators,
            uint256 depositableValidatorsCount
    ) {
        _onlyExistedNodeOperator(_nodeOperatorId);

        Packed64x4.Packed memory operatorTargetStats = _loadOperatorTargetValidatorsStats(_nodeOperatorId);
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);

        isTargetLimitActive = operatorTargetStats.get(IS_TARGET_LIMIT_ACTIVE_OFFSET) != 0;
        targetValidatorsCount = operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET);
        stuckValidatorsCount = stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET);
        refundedValidatorsCount = stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET);
        stuckPenaltyEndTimestamp = stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET);

        (totalExitedValidators, totalDepositedValidators, depositableValidatorsCount) =
            _getNodeOperatorValidatorsSummary(_nodeOperatorId);
    }

    function _getNodeOperatorValidatorsSummary(uint256 _nodeOperatorId) internal view returns (
        uint256 totalExitedValidators,
        uint256 totalDepositedValidators,
        uint256 depositableValidatorsCount
    ) {
        uint256 totalMaxValidators;
        (totalMaxValidators, totalExitedValidators, totalDepositedValidators) =
            _getNodeOperatorWithLimitApplied(_nodeOperatorId);

        depositableValidatorsCount = totalMaxValidators - totalDepositedValidators;
    }

    function isOperatorPenalized(uint256 _nodeOperatorId, bool _withClearedPenalty) public view returns (bool) {
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        return stuckPenaltyStats.get(REFUNDED_VALIDATORS_COUNT_OFFSET) < stuckPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET)
            || block.timestamp <= stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET)
            || (_withClearedPenalty && stuckPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET) != 0);
    }

    function clearNodeOperatorPenalty(uint256 _nodeOperatorId) external returns (bool) {
        require(!isOperatorPenalized(_nodeOperatorId, false), "CANT_CLEAR_PANLTY");
        Packed64x4.Packed memory stuckPenaltyStats = _loadOperatorStuckPenaltyStats(_nodeOperatorId);
        stuckPenaltyStats.set(STUCK_PENALTY_END_TIMESTAMP_OFFSET, 0);
        _saveOperatorStuckPenaltyStats(_nodeOperatorId, stuckPenaltyStats);
        _updateTotalMaxValidatorsCount(_nodeOperatorId);
    }

    /// @notice Returns total number of node operators
    function getNodeOperatorsCount() public view returns (uint256) {
        return TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
    }

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() public view returns (uint256) {
        return ACTIVE_OPERATORS_COUNT_POSITION.getStorageUint256();
    }

    /// @notice Returns if the node operator with given id is active
    function getNodeOperatorIsActive(uint256 _nodeOperatorId) public view returns (bool) {
        return _nodeOperators[_nodeOperatorId].active;
    }

    /// @notice Returns up to `_limit` node operator ids starting from the `_offset`.
    function getNodeOperatorIds(uint256 _offset, uint256 _limit)
        external
        view
        returns (uint256[] memory nodeOperatorIds) {
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        if (_offset >= nodeOperatorsCount || _limit == 0) return;
        nodeOperatorIds = new uint256[](Math256.min(_limit, nodeOperatorsCount - _offset));
        for (uint256 i = 0; i < nodeOperatorIds.length; ++i) {
            nodeOperatorIds[i] = _offset + i;
        }
    }

    /// @notice Returns a counter that MUST change it's value when any of the following happens:
    ///     1. a node operator's deposit data is added
    ///     2. a node operator's deposit data is removed
    ///     3. a node operator's ready-to-deposit data size is changed
    ///     4. a node operator was activated/deactivated
    ///     5. a node operator's deposit data is used for the deposit
    function getNonce() external view returns (uint256) {
        return KEYS_OP_INDEX_POSITION.getStorageUint256();
    }

    /// @notice Returns a counter that MUST change its value whenever the deposit data set changes.
    ///     Below is the typical list of actions that requires an update of the nonce:
    ///     1. a node operator's deposit data is added
    ///     2. a node operator's deposit data is removed
    ///     3. a node operator's ready-to-deposit data size is changed
    ///     4. a node operator was activated/deactivated
    ///     5. a node operator's deposit data is used for the deposit
    ///     Note: Depending on the StakingModule implementation above list might be extended
    /// @dev DEPRECATED use getNonce() instead
    function getKeysOpIndex() external view returns (uint256) {
        return KEYS_OP_INDEX_POSITION.getStorageUint256();
    }

    /// @notice distributes rewards among node operators
    /// @return the amount of stETH shares distributed among node operators
    function _distributeRewards() internal returns (uint256 distributed) {
        IStETH stETH = IStETH(getLocator().lido());

        uint256 sharesToDistribute = stETH.sharesOf(address(this));
        if (sharesToDistribute == 0) {
            return;
        }

        (address[] memory recipients, uint256[] memory shares, bool[] memory penalized) =
            getRewardsDistribution(sharesToDistribute);

        distributed = 0;

        for (uint256 idx; idx < recipients.length; ++idx) {
            /// @dev skip ultra-low amounts processing to avoid transfer zero amount in case of a penalty
            if (shares[idx] < 2) continue;
            if (penalized[idx]) {
                /// @dev half reward punishment
                /// @dev ignore remainder since it accumulated on contract balance
                shares[idx] >>= 1;
                IBurner(getLocator().burner()).requestBurnShares(address(this), shares[idx]);
                emit NodeOperatorPenalized(recipients[idx], shares[idx]);
            }
            stETH.transferShares(recipients[idx], shares[idx]);
            distributed = distributed.add(shares[idx]);
            emit RewardsDistributed(recipients[idx], shares[idx]);
        }
    }

    function getLocator() public view returns (ILidoLocator) {
        return ILidoLocator(LIDO_LOCATOR_POSITION.getStorageAddress());
    }

    function getStuckPenaltyDelay() public view returns (uint256) {
        return STUCK_PENALTY_DELAY_POSITION.getStorageUint256();
    }

    function setStuckPenaltyDelay(uint256 _delay) external {
        _auth(MANAGE_NODE_OPERATOR_ROLE);

        _setStuckPenaltyDelay(_delay);
    }

    function _setStuckPenaltyDelay(uint256 _delay) internal {
        STUCK_PENALTY_DELAY_POSITION.setStorageUint256(_delay);
    }

    function _increaseValidatorsKeysNonce() internal {
        uint256 keysOpIndex = KEYS_OP_INDEX_POSITION.getStorageUint256() + 1;
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex);
        /// @dev [DEPRECATED] event preserved for tooling compatibility
        emit KeysOpIndexSet(keysOpIndex);
        emit NonceChanged(keysOpIndex);
    }

    function _loadTotalSigningKeysStats() internal view returns (Packed64x4.Packed memory) {
        return _nodeOperatorTotals.signingKeysStats;
    }

    function _saveTotalSigningKeysStats(Packed64x4.Packed memory _val) internal {
        _nodeOperatorTotals.signingKeysStats = _val;
    }

    function _loadOperatorTargetValidatorsStats(uint256 _nodeOperatorId) internal view returns (Packed64x4.Packed memory) {
        return _nodeOperators[_nodeOperatorId].targetValidatorsStats;
    }

    function _saveOperatorTargetValidatorsStats(uint256 _nodeOperatorId, Packed64x4.Packed memory _val) internal {
        _nodeOperators[_nodeOperatorId].targetValidatorsStats = _val;
    }

    function _loadOperatorStuckPenaltyStats(uint256 _nodeOperatorId) internal view returns (Packed64x4.Packed memory) {
        return _nodeOperators[_nodeOperatorId].stuckPenaltyStats;
    }

    function _saveOperatorStuckPenaltyStats(uint256 _nodeOperatorId, Packed64x4.Packed memory _val) internal {
        _nodeOperators[_nodeOperatorId].stuckPenaltyStats = _val;
    }

    function _loadOperatorSigningKeysStats(uint256 _nodeOperatorId) internal view returns (Packed64x4.Packed memory) {
        return _nodeOperators[_nodeOperatorId].signingKeysStats;
    }

    function _saveOperatorSigningKeysStats(uint256 _nodeOperatorId, Packed64x4.Packed memory _val) internal {
        _nodeOperators[_nodeOperatorId].signingKeysStats = _val;
    }

    function _requireAuth(bool _pass) internal pure {
        require(_pass, "APP_AUTH_FAILED");
    }

    function _requireNotSameValue(bool _pass) internal pure {
        require(_pass, "VALUE_IS_THE_SAME");
    }

    function _requireValidRange(bool _pass) internal pure {
        require(_pass, "OUT_OF_RANGE");
    }

    function _onlyCorrectNodeOperatorState(bool _pass) internal pure {
        require(_pass, "WRONG_OPERATOR_ACTIVE_STATE");
    }

    function _auth(bytes32 _role) internal view {
        _requireAuth(canPerform(msg.sender, _role, new uint256[](0)));
    }

    function _authP(bytes32 _role, uint256[] _params) internal view {
        _requireAuth(canPerform(msg.sender, _role, _params));
    }

    function _onlyNodeOperatorManager(address _sender, uint256 _nodeOperatorId) internal view {
        bool isRewardAddress = _sender == _nodeOperators[_nodeOperatorId].rewardAddress;
        _requireAuth(isRewardAddress || canPerform(_sender, MANAGE_SIGNING_KEYS, arr(_nodeOperatorId)));
    }

    function _onlyExistedNodeOperator(uint256 _nodeOperatorId) internal view {
        _requireValidRange(_nodeOperatorId < getNodeOperatorsCount());
    }

    function _onlyValidNodeOperatorName(string _name) internal pure {
        require(bytes(_name).length > 0 && bytes(_name).length <= MAX_NODE_OPERATOR_NAME_LENGTH, "WRONG_NAME_LENGTH");
    }

    function _onlyNonZeroAddress(address _a) internal pure {
        require(_a != address(0), "ZERO_ADDRESS");
    }
}
