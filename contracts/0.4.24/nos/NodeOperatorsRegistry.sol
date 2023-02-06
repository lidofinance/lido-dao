// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {AragonApp} from "@aragon/os/contracts/apps/AragonApp.sol";
import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";

import {Math64} from "../lib/Math64.sol";
import {MemUtils} from "../../common/lib/MemUtils.sol";
import {UnstrcturedStorageMapping} from "../../common/lib/UnstrcturedStorageMapping.sol";
import {MinFirstAllocationStrategy} from "../../common/lib/MinFirstAllocationStrategy.sol";
import {ILidoLocator} from "../../common/interfaces/ILidoLocator.sol";
import {SigningKeys} from "../lib/SigningKeys.sol";
import {Versioned} from "../utils/Versioned.sol";
import "hardhat/console.sol";

interface IStETH {
    function sharesOf(address _account) external view returns (uint256);
    function transferShares(address _recipient, uint256 _sharesAmount) external returns (uint256);
    function burnShares(address _account, uint256 _sharesAmount) external returns (uint256 newTotalShares);
}

/// @dev This interface describes only tiny part of the full interface, which NodeOperatorsRegistry must implement
///      See 0.8.9/interface/IStakingModule.sol for the full version.
///      We don't inherit 0.8.9 IStakingModule due to the solidity version conflict.
interface IStakingModule {
    // function updateStuckValidatorsKeysCount(uint256 nodeOperatorId, uint64 stuckValidatorsCount) external;

    event ValidatorsKeysNonceChanged(uint256 validatorsKeysNonce);
    event StuckValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 stuckValidatorsCount);
    event ForgivenValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 forgivenValidatorsCount);
}

library Packed64 {
    using SafeMath64 for uint64;
    using Packed64 for uint256;

    //extract n-th uint64 from uint256
    function get(uint256 v, uint8 n) internal pure returns (uint64) {
        // n &= 3; //be sure < 4
        // assert(n < 4);
        return uint64((v >> (64 * n)) & 0xFFFFFFFFFFFFFFFF);
    }

    //merge n-th uint64 to uint256
    function set(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        // n &= 3; //be sure < 4
        // assert(n < 4);
        //number = number & ~(1 << n) | (x << n);
        return v & ~(uint256(0xFFFFFFFFFFFFFFFF) << (64 * n)) | ((uint256(x) & 0xFFFFFFFFFFFFFFFF) << (64 * n));
    }

    function inc(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        return v.set(n, v.get(n).add(x));
    }

    function dec(uint256 v, uint8 n, uint64 x) internal pure returns (uint256) {
        return v.set(n, v.get(n).sub(x));
    }

    function cpy(uint256 v, uint8 na, uint8 nb) internal pure returns (uint256) {
        return v.set(nb, v.get(na));
    }

    function sum(uint256 v, uint8 na, uint8 nb) internal pure returns (uint256) {
        return v.get(na).add(v.get(nb));
    }

    function diff(uint256 v, uint8 na, uint8 nb) internal pure returns (uint256) {
        return v.get(na).sub(v.get(nb));
    }
}

/// @title Node Operator registry
/// @notice Node Operator registry manages signing keys and other node operator data.
/// @dev Must implement the full version of IStakingModule interface, not only the one declared locally.
///      It's also responsible for distributing rewards to node operators.
/// NOTE: the code below assumes moderate amount of node operators, i.e. up to `MAX_NODE_OPERATORS_COUNT`.
contract NodeOperatorsRegistry is AragonApp, IStakingModule, Versioned {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;
    using UnstrcturedStorageMapping for bytes32;
    using SigningKeys for bytes32;
    using Packed64 for uint256;

    //
    // EVENTS
    //
    event NodeOperatorAdded(uint256 nodeOperatorId, string name, address rewardAddress, uint64 stakingLimit);
    event NodeOperatorActiveSet(uint256 indexed nodeOperatorId, bool active);
    event NodeOperatorNameSet(uint256 indexed nodeOperatorId, string name);
    event NodeOperatorRewardAddressSet(uint256 indexed nodeOperatorId, address rewardAddress);
    event NodeOperatorStakingLimitSet(uint256 indexed nodeOperatorId, uint64 stakingLimit);
    event NodeOperatorTotalStoppedValidatorsReported(uint256 indexed nodeOperatorId, uint64 totalStopped);
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

    event TargetValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 targetValidatorsCount);
    // event TargetValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 totalTargetValidatorsCount, uint64 unavaliableKeysCount);
    event ExcessValidatorsCountChanged(uint256 indexed nodeOperatorId, uint256 excessValidatorsCount);

    event NodeOperatorPenalized(address indexed receipientAddress, uint256 sharesPenalizedAmount);

    //
    // ACL
    //
    // bytes32 public constant MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 public constant MANAGE_SIGNING_KEYS = 0x75abc64490e17b40ea1e66691c3eb493647b24430b358bd87ec3e5127f1621ee;
    // bytes32 public constant ADD_NODE_OPERATOR_ROLE = keccak256("ADD_NODE_OPERATOR_ROLE");
    bytes32 public constant ADD_NODE_OPERATOR_ROLE = 0xe9367af2d321a2fc8d9c8f1e67f0fc1e2adf2f9844fb89ffa212619c713685b2;
    // bytes32 public constant SET_NODE_OPERATOR_NAME_ROLE = keccak256("SET_NODE_OPERATOR_NAME_ROLE");
    // bytes32 public constant SET_NODE_OPERATOR_NAME_ROLE =
    //     0x58412970477f41493548d908d4307dfca38391d6bc001d56ffef86bd4f4a72e8;
    // bytes32 public constant SET_NODE_OPERATOR_ADDRESS_ROLE = keccak256("SET_NODE_OPERATOR_ADDRESS_ROLE");
    // bytes32 public constant SET_NODE_OPERATOR_ADDRESS_ROLE =
    //     0xbf4b1c236312ab76e456c7a8cca624bd2f86c74a4f8e09b3a26d60b1ce492183;
    // bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE = keccak256("SET_NODE_OPERATOR_LIMIT_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE =
        0x07b39e0faf2521001ae4e58cb9ffd3840a63e205d288dc9c93c3774f0d794754;
    // bytes32 public constant INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE = keccak256("INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE");
    bytes32 public constant INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE =
        0xeaf200990dc6840b2b98dda560b1fd49fc2bbb13aae6f2864e84b7af0b3026fe;
    // bytes32 public constant ACTIVATE_NODE_OPERATOR_ROLE = keccak256("ACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant ACTIVATE_NODE_OPERATOR_ROLE =
        0x43b30579428d1f58f32a91271777eb4abfafe49c37a1333605ae6805efa05ddc;
    // bytes32 public constant DEACTIVATE_NODE_OPERATOR_ROLE = keccak256("DEACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant DEACTIVATE_NODE_OPERATOR_ROLE =
        0xd143dfe933ec009d7da9f00bee064bd3db6a56ff95197dcef9d4b0741a393b6d;
    // bytes32 public constant STAKING_ROUTER_ROLE = keccak256("STAKING_ROUTER_ROLE");
    bytes32 public constant STAKING_ROUTER_ROLE = 0xbb75b874360e0bfd87f964eadd8276d8efb7c942134fc329b513032d0803e0c6;
    // bytes32 public constant UPDATE_TARGET_VALIDATORS_KEYS_COUNT_ROLE =
    //     keccak256("UPDATE_TARGET_VALIDATORS_KEYS_COUNT_ROLE");

    //
    // CONSTANTS
    //
    uint256 public constant MAX_NODE_OPERATORS_COUNT = 200;
    uint256 public constant MAX_NODE_OPERATOR_NAME_LENGTH = 255;

    uint256 internal constant UINT64_MAX = uint256(~uint64(0));
    uint256 internal constant STUCK_VALIDATORS_PENALTY_DELAY = 2 days;

    // SigningKeysStats
    uint8 internal constant VETTED_KEYS_COUNT_OFFSET = 0;
    /// @dev Number of keys in the EXITED state for this operator for all time
    uint8 internal constant EXITED_KEYS_COUNT_OFFSET = 1;
    /// @dev Number of keys of this operator which were in DEPOSITED state for all time
    uint8 internal constant DEPOSITED_KEYS_COUNT_OFFSET = 2;
    /// @dev Total number of keys of this operator for all time
    uint8 internal constant TOTAL_KEYS_COUNT_OFFSET = 3;

    // TargetValidatorsStats
    /// @dev relative target active validators limit for operator, set by DAO, UINT64_MAX === no limit
    uint8 internal constant TARGET_VALIDATORS_COUNT_OFFSET = 0;
    /// @dev excess validators count for operator that will be forced to exit
    uint8 internal constant EXCESS_VALIDATORS_COUNT_OFFSET = 1;

    // StuckPenaltyStats
    /// @dev stuck keys count from oracle report
    uint8 internal constant STUCK_VALIDATORS_COUNT_OFFSET = 0;
    /// @dev forgiven keys count from dao
    uint8 internal constant FORGIVEN_VALIDATORS_COUNT_OFFSET = 1;
    uint8 internal constant STUCK_PENALTY_END_TIMESTAMP_OFFSET = 2;

    //
    // UNSTRUCTURED STORAGE POSITIONS
    //
    // bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = keccak256("lido.NodeOperatorsRegistry.signingKeysMappingName");
    bytes32 internal constant SIGNING_KEYS_MAPPING_NAME =
        0xeb2b7ad4d8ce5610cfb46470f03b14c197c2b751077c70209c5d0139f7c79ee9;

    // bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.NodeOperatorsRegistry.contractVersion");
    // bytes32 internal constant CONTRACT_VERSION_POSITION =
    //     0xd5444e06b5773cd8c7a9ca51e00a75c90f604a23a58df8f8ad5a8476fcf99aed;

    // bytes32 internal constant STETH_POSITION = keccak256("lido.NodeOperatorsRegistry.stETH");
    // bytes32 internal constant STETH_POSITION = 0xec9ed0746eb1900b7a28ec0ec00fa9acae3f6b909bcaec184f2cc4fb3634d753;
    bytes32 internal constant LIDO_LOCATOR_POSITION = 0xec9ed0746eb1900b7a28ec0ec00fa9acae3f6b909bcaec184f2cc4fb3634d753;
    // bytes32 internal constant LIDO_LOCATOR_POSITION = keccak256("lido.NodeOperatorsRegistry.lidoLocator");

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
    bytes32 internal constant KEYS_OP_INDEX_POSITION =
        0xcd91478ac3f2620f0776eacb9c24123a214bcb23c32ae7d28278aa846c8c380e;

    /// @dev module type
    // bytes32 internal constant TYPE_POSITION = keccak256("lido.NodeOperatorsRegistry.type");
    bytes32 internal constant TYPE_POSITION = 0xbacf4236659a602d72c631ba0b0d67ec320aaf523f3ae3590d7faee4f42351d0;

    // bytes32 internal constant TOTAL_SIGNING_KEYS_STATS = keccak256("lido.NodeOperatorsRegistry.totalSigningKeysStats");
    bytes32 internal constant TOTAL_SIGNING_KEYS_STATS =
        0xc33a2ef669a34f5b2d3bbc4b9820f8b3aa025f75811cb235399cc3eb412083c5;

    // bytes32 internal constant TOTAL_VALIDATORS_STATS = keccak256("lido.NodeOperatorsRegistry.totaValidatorslStats");
    bytes32 internal constant TOTAL_VALIDATORS_STATS =
        0xc33a2ef669a34f5b2d3bbc4b9820f8b3aa025f75811cb235399cc3eb41234653;
    bytes32 internal constant OPERATOR_VALIDATORS_STATS_MAP =
        0xc33a2ef669a34f5b2d3bbc4b9820f8b3aa025f75811cb235399cc3eb41231111;
    bytes32 internal constant OPERATOR_STUCK_PENALTY_STATS_MAP =
        0xc33a2ef669a34f5b2d3bbc4b9820f8b3aa025f75811cb235399cc3eb41232222;

    /// @dev DAO target limit, used to check how many keys shoud be go to exit
    ///      UINT64_MAX - unlim
    ///      0 - all deposited keys
    ///      N < deposited keys -
    ///      deposited < N < vetted - use (N-deposited) as available
    // bytes32 internal constant TOTAL_UNAVAILABLE_VALIDATORS_KEYS_COUNT = keccak256("lido.NodeOperatorsRegistry.totalUnavailableKeysCount");

    // bytes32 internal constant TOTAL_STUCK_KEYS_COUNT = keccak256("lido.NodeOperatorsRegistry.totalStuckKeysCount");

    //
    // DATA TYPES
    //

    /// @dev Node Operator parameters and internal state
    struct NodeOperator {
        /// @dev Flag indicating if the operator can participate in further staking and reward distribution
        bool active;
        /// @dev Ethereum address on Execution Layer which receives steth rewards for this operator
        address rewardAddress;
        /// @dev Human-readable name
        string name;
        /// @dev The below variables store the signing keys info of the node operator.
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

        /// @dev Maximum number of keys for this operator to be deposited for all time
        uint64 vettedSigningKeysCount;
        /// @dev Number of keys in the EXITED state for this operator for all time
        uint64 exitedSigningKeysCount;
        /// @dev Total number of keys of this operator for all time
        uint64 totalSigningKeysCount;
        /// @dev Number of keys of this operator which were in DEPOSITED state for all time
        uint64 depositedSigningKeysCount;
    }

    //
    // STORAGE VARIABLES
    //

    /// @dev Mapping of all node operators. Mapping is used to be able to extend the struct.
    mapping(uint256 => NodeOperator) internal _nodeOperators;

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
        require(!isPetrified(), "PETRIFIED");
        require(hasInitialized(), "NOT_INITIALIZED");
        _checkContractVersion(0);
        _initialize_v2(_locator, _type);

        uint256 totalOperators = getNodeOperatorsCount();

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        for (uint256 operatorId = 0; operatorId < totalOperators; ++operatorId) {
            NodeOperator storage operator = _nodeOperators[operatorId];

            uint64 totalSigningKeysCount = operator.totalSigningKeysCount;
            uint64 vettedSigningKeysCount = operator.vettedSigningKeysCount;
            uint64 depositedSigningKeysCount = operator.depositedSigningKeysCount;
            uint64 exitedSigningKeysCount = operator.exitedSigningKeysCount;

            uint64 vettedSigningKeysCountBefore = vettedSigningKeysCount;
            uint64 vettedSigningKeysCountAfter =
                Math64.min(totalSigningKeysCount, Math64.max(depositedSigningKeysCount, vettedSigningKeysCountBefore));

            if (!operator.active) {
                // trim vetted signing keys count when node operator is not active
                vettedSigningKeysCountAfter = depositedSigningKeysCount;
            }

            if (vettedSigningKeysCountBefore != vettedSigningKeysCountAfter) {
                _nodeOperators[operatorId].vettedSigningKeysCount = vettedSigningKeysCountAfter;
                emit VettedSigningKeysCountChanged(operatorId, vettedSigningKeysCountAfter);
            }

            totalSigningKeysStats = totalSigningKeysStats.inc(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCountAfter);
            totalSigningKeysStats = totalSigningKeysStats.inc(DEPOSITED_KEYS_COUNT_OFFSET, depositedSigningKeysCount);
            totalSigningKeysStats = totalSigningKeysStats.inc(EXITED_KEYS_COUNT_OFFSET, exitedSigningKeysCount);
            totalSigningKeysStats = totalSigningKeysStats.inc(TOTAL_KEYS_COUNT_OFFSET, totalSigningKeysCount);
            // totalSigningKeysStats.increaseVettedSigningKeysCount(vettedSigningKeysCountAfter);
            // totalSigningKeysStats.increaseDepositedSigningKeysCount(depositedSigningKeysCount);
            // totalSigningKeysStats.increaseExitedSigningKeysCount(exitedSigningKeysCount);
            // totalSigningKeysStats.increaseTotalSigningKeysCount(totalSigningKeysCount);
        }

        _setTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    function _initialize_v2(address _locator, bytes32 _type) internal {
        _onlyNonZeroAddress(_locator);
        LIDO_LOCATOR_POSITION.setStorageAddress(_locator);
        TYPE_POSITION.setStorageBytes32(_type);

        _setContractVersion(2);

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
        _auth(ADD_NODE_OPERATOR_ROLE);

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
        _auth(ACTIVATE_NODE_OPERATOR_ROLE);

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(!nodeOperator.active, "OPERATOR_ACTIVATED");

        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(getActiveNodeOperatorsCount() + 1);

        nodeOperator.active = true;

        emit NodeOperatorActiveSet(_nodeOperatorId, true);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Deactivates active node operator with given id
    /// @param _nodeOperatorId Node operator id to deactivate
    function deactivateNodeOperator(uint256 _nodeOperatorId) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(DEACTIVATE_NODE_OPERATOR_ROLE);

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(nodeOperator.active, "OPERATOR_DEACTIVATED");

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.sub(1));

        nodeOperator.active = false;

        emit NodeOperatorActiveSet(_nodeOperatorId, false);

        uint64 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;
        uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

        // reset vetted keys count to the deposited validators count
        if (vettedSigningKeysCount > depositedSigningKeysCount) {
            nodeOperator.vettedSigningKeysCount = depositedSigningKeysCount;
            emit VettedSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);

            uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
            totalSigningKeysStats =
                totalSigningKeysStats.dec(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCount - depositedSigningKeysCount);
            _setTotalSigningKeysStats(totalSigningKeysStats);
        }
        _increaseValidatorsKeysNonce();
    }

    /// @notice Change human-readable name of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set name for
    /// @param _name New human-readable name of the node operator
    function setNodeOperatorName(uint256 _nodeOperatorId, string _name) external {
        _onlyValidNodeOperatorName(_name);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _authP(ADD_NODE_OPERATOR_ROLE, arr(uint256(_nodeOperatorId)));

        // require(keccak256(bytes(_nodeOperators[_nodeOperatorId].name)) != keccak256(bytes(_name)), "NODE_OPERATOR_NAME_IS_THE_SAME");
        _nodeOperators[_nodeOperatorId].name = _name;
        emit NodeOperatorNameSet(_nodeOperatorId, _name);
    }

    /// @notice Change reward address of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _rewardAddress Execution layer Ethereum address to set as reward address
    function setNodeOperatorRewardAddress(uint256 _nodeOperatorId, address _rewardAddress) external {
        _onlyNonZeroAddress(_rewardAddress);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _authP(ADD_NODE_OPERATOR_ROLE, arr(uint256(_nodeOperatorId), uint256(_rewardAddress)));

        // require(_nodeOperators[_nodeOperatorId].rewardAddress != _rewardAddress, "NODE_OPERATOR_ADDRESS_IS_THE_SAME");
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

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(nodeOperator.active, "OPERATOR_DEACTIVATED");

        uint64 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
        uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;
        uint64 vettedSigningKeysCountBefore = nodeOperator.vettedSigningKeysCount;

        uint64 vettedSigningKeysCountAfter =
            Math64.min(totalSigningKeysCount, Math64.max(_vettedSigningKeysCount, depositedSigningKeysCount));

        if (vettedSigningKeysCountAfter == vettedSigningKeysCountBefore) {
            return;
        }

        nodeOperator.vettedSigningKeysCount = vettedSigningKeysCountAfter;

        uint256 totalTargetStats = _getTotalTargetValidtatorsStats();
        // TargetValidatorsStats memory totalValidatorStats = _getTotalValidtatorsStats();
        // TargetValidatorsStats memory operatorTargetStats = _operatorTargetStats[_nodeOperatorId];
        uint256 operatorTargetStats = _getOperatorTargetValidtatorsStats(_nodeOperatorId);

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();

        uint64 diff;
        if (vettedSigningKeysCountAfter > vettedSigningKeysCountBefore) {
            diff = vettedSigningKeysCountAfter - vettedSigningKeysCountBefore;
            totalSigningKeysStats = totalSigningKeysStats.inc(VETTED_KEYS_COUNT_OFFSET, diff);
            // totalSigningKeysStats.increaseVettedSigningKeysCount(diff);

            if (operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET) == 0) {
                // totalTargetStats.targetValidatorsCount = totalTargetStats.targetValidatorsCount.add(diff);
                totalTargetStats = totalTargetStats.inc(TARGET_VALIDATORS_COUNT_OFFSET, diff);
            }
        } else {
            diff = vettedSigningKeysCountBefore - vettedSigningKeysCountAfter;
            totalSigningKeysStats = totalSigningKeysStats.dec(VETTED_KEYS_COUNT_OFFSET, diff);
            // totalSigningKeysStats.decreaseVettedSigningKeysCount(diff);
            if (operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET) == 0) {
                totalTargetStats = totalTargetStats.dec(TARGET_VALIDATORS_COUNT_OFFSET, diff);
            }
        }

        _setTotalSigningKeysStats(totalSigningKeysStats);
        _setTotalValidtatorsStats(totalTargetStats);
        // _totalTargetStats = totalTargetStats;

        emit VettedSigningKeysCountChanged(_nodeOperatorId, vettedSigningKeysCountAfter);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Called by StakingRouter to signal that stETH rewards were minted for this module.
    function handleRewardsMinted(uint256) external {
        _auth(STAKING_ROUTER_ROLE);
        // since we're pushing rewards to operators after exited validators counts are
        // updated (as opposed to pulling by node ops), we don't need any handling here
    }

    /// @notice Called by StakingRouter to update the number of the validators of the given node
    /// operator that were requested to exit but failed to do so in the max allowed time
    ///
    /// @param _nodeOperatorId Id of the node operator
    /// @param _stuckValidatorsCount New number of stuck validators of the node operator
    function updateStuckValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _stuckValidatorsCount) external {
        _updateStuckValidatorsKeysCount(_nodeOperatorId, uint64(_stuckValidatorsCount));
    }

    /// @notice Called by StakingRouter to update the number of the validators in the EXITED state
    /// for node operator with given id
    ///
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    /// @return Total number of exited validators across all node operators.
    function updateExitedValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsKeysCount)
        external
        returns (uint256)
    {
        return _updateExitedValidatorsKeysCount(_nodeOperatorId, uint64(_exitedValidatorsKeysCount), false);
    }

    /// @notice Called by StakingRouter after oracle finishes updating exited keys counts for all operators.
    function finishUpdatingExitedValidatorsKeysCount() external {
        _auth(STAKING_ROUTER_ROLE);
        // for the permissioned module, we're distributing rewards within oracle operation
        // since the number of node ops won't be high and thus gas costs are limited
        _distributeRewards();
    }

    /// FIXME: this conflicts with the two-phase exited keys reporting in the staking router.
    /// If we want to allow hand-correcting the oracle, we need to also support it in the
    /// staking router.
    ///
    /// @notice Unsafely updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    /// @return Total number of exited validators across all node operators.
    function unsafeUpdateValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsKeysCount,
        uint256 _stuckValidatorsKeysCount
    ) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        _updateStuckValidatorsKeysCount(_nodeOperatorId, uint64(_stuckValidatorsKeysCount));
        _updateExitedValidatorsKeysCount(_nodeOperatorId, uint64(_exitedValidatorsKeysCount), true);
    }
    // increasing operator's and total excess validators counters

    function _updExcessValidators(uint256 _nodeOperatorId, uint64 _newActiveValidatorsCount) internal {
        uint256 operatorTargetStats = _getOperatorTargetValidtatorsStats(_nodeOperatorId);
        uint64 targetCount = operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET);
        uint64 excessCount = operatorTargetStats.get(EXCESS_VALIDATORS_COUNT_OFFSET);

        // check if operator's has target validators count set
        if (targetCount > 0) {
            // uint64 excessValidatorsCount = _validatorsStats[_nodeOperatorId].excessValidatorsCount;
            // TargetValidatorsStats memory totalTargetStats = _totalTargetStats;
            uint256 totalTargetStats = _getTotalTargetValidtatorsStats();

            // TargetValidatorsStats memory totalTargetStats = _getTotalValidtatorsStats();
            if (targetCount < _newActiveValidatorsCount) {
                uint64 diff;
                // new excess validators
                diff = _newActiveValidatorsCount.sub(targetCount); //.sub(excessValidatorsCount));
                if (diff > excessCount) {
                    diff -= excessCount;
                    operatorTargetStats = operatorTargetStats.inc(EXCESS_VALIDATORS_COUNT_OFFSET, diff);
                    // _operatorTargetStats[_nodeOperatorId].excessValidatorsCount =
                    //     operatorTargetStats.excessValidatorsCount.add(diff);

                    totalTargetStats = totalTargetStats.inc(EXCESS_VALIDATORS_COUNT_OFFSET, diff);
                    // totalTargetStats.excessValidatorsCount = totalTargetStats.excessValidatorsCount.add(diff);
                    // _setTotalValidtatorsStats(totalTargetStats);
                    //  _totalTargetStats = totalTargetStats;
                } else if (diff < excessCount) {
                    diff = excessCount - diff;
                    operatorTargetStats = operatorTargetStats.dec(EXCESS_VALIDATORS_COUNT_OFFSET, diff);
                    // _operatorTargetStats[_nodeOperatorId].excessValidatorsCount =
                    //     operatorTargetStats.excessValidatorsCount.sub(diff);
                    totalTargetStats = totalTargetStats.dec(EXCESS_VALIDATORS_COUNT_OFFSET, diff);
                    // totalTargetStats.excessValidatorsCount = totalTargetStats.excessValidatorsCount.sub(diff);
                    // _setTotalValidtatorsStats(totalTargetStats);
                }
            } else if (excessCount > 0) {
                operatorTargetStats.set(EXCESS_VALIDATORS_COUNT_OFFSET, 0);
                totalTargetStats = totalTargetStats.dec(EXCESS_VALIDATORS_COUNT_OFFSET, excessCount);
                // _setTotalValidtatorsStats(totalTargetStats);
            }
            _setOperatorTargetValidtatorsStats(_nodeOperatorId, operatorTargetStats);
            _setTotalValidtatorsStats(totalTargetStats);
        }
    }

    function _updateExitedValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint64 _exitedValidatorsKeysCount,
        bool _allowDecrease
    ) internal returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        uint64 depositedSigningKeysCount = _nodeOperators[_nodeOperatorId].depositedSigningKeysCount;
        uint64 exitedValidatorsCountBefore = _nodeOperators[_nodeOperatorId].exitedSigningKeysCount;

        if (exitedValidatorsCountBefore == _exitedValidatorsKeysCount) {
            return;
        }

        require(_exitedValidatorsKeysCount <= depositedSigningKeysCount, "INVALID_EXITED_VALIDATORS_COUNT");

        _nodeOperators[_nodeOperatorId].exitedSigningKeysCount = _exitedValidatorsKeysCount;

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        if (_exitedValidatorsKeysCount > exitedValidatorsCountBefore) {
            totalSigningKeysStats = totalSigningKeysStats.inc(
                EXITED_KEYS_COUNT_OFFSET, _exitedValidatorsKeysCount - exitedValidatorsCountBefore
            );
            // totalSigningKeysStats.increaseExitedSigningKeysCount(
            //     _exitedValidatorsKeysCount - exitedValidatorsCountBefore
            // );
        } else {
            require(_allowDecrease, "EXITED_VALIDATORS_COUNT_DECREASED");

            totalSigningKeysStats = totalSigningKeysStats.dec(
                EXITED_KEYS_COUNT_OFFSET, exitedValidatorsCountBefore - _exitedValidatorsKeysCount
            );
            // totalSigningKeysStats.decreaseExitedSigningKeysCount(
            //     exitedValidatorsCountBefore - _exitedValidatorsKeysCount
            // );
        }
        _updExcessValidators(_nodeOperatorId, depositedSigningKeysCount - _exitedValidatorsKeysCount);

        _setTotalSigningKeysStats(totalSigningKeysStats);

        emit ExitedSigningKeysCountChanged(_nodeOperatorId, _exitedValidatorsKeysCount);

        return totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
    }

    /// @notice Updates the limit of the validators that can be used for deposit by DAO
    /// @param _nodeOperatorId Id of the node operator
    /// @param _targetValidatorsCount New number of EXITED validators of the node operator
    // function updateTargetValidatorsLimits(uint256 _nodeOperatorId, uint64 _targetValidatorsCount) external {
    //     _onlyExistedNodeOperator(_nodeOperatorId);
    //     _auth(STAKING_ROUTER_ROLE);

    //     _operatorTargetStats[_nodeOperatorId].targetValidatorsCount = _targetValidatorsCount;
    //     emit TargetValidatorsCountChanged(_nodeOperatorId, _targetValidatorsCount);

    //     /// @todo update total limits?
    // }

    /**
     * @notice Set the stuck signings keys count
     */
    function _updateStuckValidatorsKeysCount(uint256 _nodeOperatorId, uint64 _stuckValidatorsCount) internal {
        _setOperatorStuckPenaltyStats(
            _nodeOperatorId,
            _getOperatorStuckPenaltyStats(_nodeOperatorId).set(STUCK_VALIDATORS_COUNT_OFFSET, _stuckValidatorsCount)
        );
        emit StuckValidatorsCountChanged(_nodeOperatorId, _stuckValidatorsCount);
    }

    /**
     * @notice Set the forgivent signing keys count
     */
    function updateForgivenValidatorsKeysCount(uint256 _nodeOperatorId, uint64 _forgivenValidatorsCount) external {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _auth(STAKING_ROUTER_ROLE);

        uint256 stcukPenaltyStats = _getOperatorStuckPenaltyStats(_nodeOperatorId);

        // require(validatorsStats.forgivenValidatorsCount != _forgivenValidatorsCount, "NODE_OPERATOR_TARGET_LIMIT_IS_THE_SAME");
        stcukPenaltyStats = stcukPenaltyStats.set(FORGIVEN_VALIDATORS_COUNT_OFFSET, _forgivenValidatorsCount);

        if (stcukPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET) <= _forgivenValidatorsCount) {
            stcukPenaltyStats.set(
                STUCK_PENALTY_END_TIMESTAMP_OFFSET, uint64(block.timestamp + STUCK_VALIDATORS_PENALTY_DELAY)
            );
        }

        _setOperatorStuckPenaltyStats(_nodeOperatorId, stcukPenaltyStats);

        emit ForgivenValidatorsCountChanged(_nodeOperatorId, _forgivenValidatorsCount);
    }

    /// @notice Invalidates all unused validators keys for all node operators
    function _invalidateOperatorReadyToDepositKeys(uint256 _nodeOperatorId)
        internal
        returns (uint64 trimmedKeysCount, uint64 totalTargetDiff)
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        // uint64 totalSigningKeysCount = ;
        uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

        trimmedKeysCount = nodeOperator.totalSigningKeysCount - depositedSigningKeysCount;
        if (trimmedKeysCount == 0) return (0, 0);

        uint64 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;

        nodeOperator.totalSigningKeysCount = depositedSigningKeysCount;
        nodeOperator.vettedSigningKeysCount = depositedSigningKeysCount;

        // TargetValidatorsStats memory totalTargetStats = _totalTargetStats;
        if (_getOperatorTargetValidtatorsStats(_nodeOperatorId).get(TARGET_VALIDATORS_COUNT_OFFSET) == 0) {
            totalTargetDiff = vettedSigningKeysCount - depositedSigningKeysCount;

            // _totalTargetStats.targetValidatorsCount =
            //     _totalTargetStats.targetValidatorsCount.sub(vettedSigningKeysCount - depositedSigningKeysCount);
        }

        emit TotalSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);
        emit VettedSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);
        emit NodeOperatorTotalKeysTrimmed(_nodeOperatorId, trimmedKeysCount);
    }
    /// @notice Invalidates all unused validators keys for all node operators

    function invalidateReadyToDepositKeys() external {
        _auth(INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE);

        bool wereSigningKeysTrimmed = false;
        uint256 nodeOperatorsCount = getNodeOperatorsCount();

        // NodeOperator storage nodeOperator;
        // uint64 totalSigningKeysCount;
        // uint64 depositedSigningKeysCount;
        // uint64 vettedSigningKeysCount;

        uint64 trimmedKeysCount;
        uint64 totalTargetDiff;
        uint64 operatorTargetDiff;
        for (uint256 _nodeOperatorId = 0; _nodeOperatorId < nodeOperatorsCount; ++_nodeOperatorId) {
            (trimmedKeysCount, totalTargetDiff) = _invalidateOperatorReadyToDepositKeys(_nodeOperatorId);
            if (trimmedKeysCount == 0) {
                continue;
            }

            totalTargetDiff = totalTargetDiff.add(operatorTargetDiff);

            if (!wereSigningKeysTrimmed) {
                wereSigningKeysTrimmed = true;
            }
        }

        if (wereSigningKeysTrimmed) {
            uint256 totalSigningKeysStats = _getTotalSigningKeysStats();

            totalSigningKeysStats = totalSigningKeysStats.cpy(DEPOSITED_KEYS_COUNT_OFFSET, TOTAL_KEYS_COUNT_OFFSET);
            totalSigningKeysStats = totalSigningKeysStats.cpy(DEPOSITED_KEYS_COUNT_OFFSET, VETTED_KEYS_COUNT_OFFSET);
            // totalSigningKeysStats.totalSigningKeysCount = totalSigningKeysStats.depositedSigningKeysCount;
            // totalSigningKeysStats.vettedSigningKeysCount = totalSigningKeysStats.depositedSigningKeysCount;

            _setTotalSigningKeysStats(totalSigningKeysStats);

            // TargetValidatorsStats memory totalTargetStats = _totalTargetStats;
            // totalTargetStats.targetValidatorsCount = totalTargetStats.targetValidatorsCount.sub(totalTargetDiff);
            // _totalTargetStats = totalTargetStats;
            uint256 totalTargetStats = _getTotalTargetValidtatorsStats();
            totalTargetStats = totalTargetStats.dec(TARGET_VALIDATORS_COUNT_OFFSET, totalTargetDiff);
            _setTotalValidtatorsStats(totalTargetStats);

            _increaseValidatorsKeysNonce();
        }
    }

    /// @notice Requests the given number of the validator keys from the staking module
    /// @param _keysCount Requested keys count to return
    /// @return returnedKeysCount Actually returned keys count
    /// @return publicKeys Batch of the concatenated public validators keys
    /// @return signatures Batch of the concatenated signatures for returned public keys
    function requestValidatorsKeysForDeposits(uint256 _keysCount, bytes)
        external
        returns (uint256 enqueuedValidatorsKeysCount, bytes memory publicKeys, bytes memory signatures)
    {
        _auth(STAKING_ROUTER_ROLE);

        uint256[] memory nodeOperatorIds;
        uint256[] memory activeKeysCountAfterAllocation;
        uint256[] memory exitedSigningKeysCount;
        (enqueuedValidatorsKeysCount, nodeOperatorIds, activeKeysCountAfterAllocation, exitedSigningKeysCount) =
            _getSigningKeysAllocationData(_keysCount);

        if (enqueuedValidatorsKeysCount == 0) {
            return (0, new bytes(0), new bytes(0));
        }

        (publicKeys, signatures) = _loadAllocatedSigningKeys(
            enqueuedValidatorsKeysCount, nodeOperatorIds, activeKeysCountAfterAllocation, exitedSigningKeysCount
        );

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats =
            totalSigningKeysStats.inc(DEPOSITED_KEYS_COUNT_OFFSET, uint64(enqueuedValidatorsKeysCount));
        _setTotalSigningKeysStats(totalSigningKeysStats);
        _increaseValidatorsKeysNonce();
    }

    // function _readNOStats(uint256 nodeOperatorId) internal view returns ( SigningKeysStats memory) {
    //     NodeOperator storage nodeOperator = _nodeOperators[nodeOperatorId];

    //     return SigningKeysStats({
    //         vettedSigningKeysCount: nodeOperator.vettedSigningKeysCount,
    //         exitedSigningKeysCount: nodeOperator.exitedSigningKeysCount,
    //         totalSigningKeysCount: nodeOperator.totalSigningKeysCount,
    //         depositedSigningKeysCount: nodeOperator.depositedSigningKeysCount
    //     });
    // }

    function _getCorrectedNodeOperator(uint256 _nodeOperatorId)
        internal
        view
        returns (uint64 vettedSigningKeysCount, uint64 exitedSigningKeysCount, uint64 depositedSigningKeysCount)
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        if (!nodeOperator.active) return (0, 0, 0);

        vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;
        exitedSigningKeysCount = nodeOperator.exitedSigningKeysCount;
        depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

        uint64 targetValidatorsCount =
            _getOperatorTargetValidtatorsStats(_nodeOperatorId).get(TARGET_VALIDATORS_COUNT_OFFSET);

        // correct vetted count according to target
        if (targetValidatorsCount > 0) {
            if (targetValidatorsCount <= depositedSigningKeysCount.sub(exitedSigningKeysCount)) {
                vettedSigningKeysCount = depositedSigningKeysCount;
            } else {
                vettedSigningKeysCount =
                    Math64.min(vettedSigningKeysCount, exitedSigningKeysCount.add(targetValidatorsCount));
            }
        }
    }

    function _getSigningKeysAllocationData(uint256 _keysCount)
        internal
        view
        returns (
            uint256 allocatedKeysCount,
            uint256[] memory nodeOperatorIds,
            uint256[] memory activeKeyCountsAfterAllocation,
            uint256[] memory operatorsExitedSigningKeysCount
        )
    {
        uint256 activeNodeOperatorsCount = getActiveNodeOperatorsCount();
        nodeOperatorIds = new uint256[](activeNodeOperatorsCount);
        activeKeyCountsAfterAllocation = new uint256[](activeNodeOperatorsCount);
        operatorsExitedSigningKeysCount = new uint256[](activeNodeOperatorsCount);
        uint256[] memory activeKeysCapacities = new uint256[](activeNodeOperatorsCount);

        uint256 activeNodeOperatorIndex;
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        uint64 vettedSigningKeysCount;
        uint64 exitedSigningKeysCount;
        uint64 depositedSigningKeysCount;
        for (uint256 nodeOperatorId = 0; nodeOperatorId < nodeOperatorsCount; ++nodeOperatorId) {
            (vettedSigningKeysCount, exitedSigningKeysCount, depositedSigningKeysCount) =
                _getCorrectedNodeOperator(nodeOperatorId);
            // the node operator has no available signing keys
            if (depositedSigningKeysCount == vettedSigningKeysCount) continue;

            nodeOperatorIds[activeNodeOperatorIndex] = nodeOperatorId;
            operatorsExitedSigningKeysCount[activeNodeOperatorIndex] = exitedSigningKeysCount;
            activeKeyCountsAfterAllocation[activeNodeOperatorIndex] =
                depositedSigningKeysCount.sub(exitedSigningKeysCount);
            activeKeysCapacities[activeNodeOperatorIndex] = vettedSigningKeysCount.sub(exitedSigningKeysCount);
            ++activeNodeOperatorIndex;
        }

        if (activeNodeOperatorIndex == 0) return (0, new uint256[](0), new uint256[](0), new uint256[](0));

        /// @dev shrink the length of the resulting arrays if some active node operators have no available keys to be deposited
        if (activeNodeOperatorIndex < activeNodeOperatorsCount) {
            assembly {
                mstore(nodeOperatorIds, activeNodeOperatorIndex)
                mstore(activeKeyCountsAfterAllocation, activeNodeOperatorIndex)
                mstore(operatorsExitedSigningKeysCount, activeNodeOperatorIndex)
                mstore(activeKeysCapacities, activeNodeOperatorIndex)
            }
        }

        allocatedKeysCount = MinFirstAllocationStrategy.allocate(
            activeKeyCountsAfterAllocation, activeKeysCapacities, uint64(_keysCount)
        );

        assert(allocatedKeysCount <= _keysCount);
    }

    function _loadAllocatedSigningKeys(
        uint256 _keysCountToLoad,
        uint256[] memory _nodeOperatorIds,
        uint256[] memory _activeKeyCountsAfterAllocation,
        uint256[] memory _exitedSigningKeysCount
    ) internal returns (bytes memory pubkeys, bytes memory signatures) {
        (pubkeys, signatures) = SigningKeys._initKeySig(_keysCountToLoad);

        uint256 loadedKeysCount = 0;
        uint64 depositedSigningKeysCountBefore;
        uint64 depositedSigningKeysCountAfter;
        uint256 keyIndex;
        for (uint256 i = 0; i < _nodeOperatorIds.length; ++i) {
            NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorIds[i]];

            depositedSigningKeysCountBefore = nodeOperator.depositedSigningKeysCount;
            depositedSigningKeysCountAfter = uint64(_exitedSigningKeysCount[i].add(_activeKeyCountsAfterAllocation[i]));

            if (depositedSigningKeysCountBefore == depositedSigningKeysCountAfter) continue;

            for (keyIndex = depositedSigningKeysCountBefore; keyIndex < depositedSigningKeysCountAfter; ++keyIndex) {
                SIGNING_KEYS_MAPPING_NAME._loadSigningKeyAndAppend(
                    _nodeOperatorIds[i], keyIndex, loadedKeysCount, pubkeys, signatures
                );
                ++loadedKeysCount;
            }
            emit DepositedSigningKeysCountChanged(_nodeOperatorIds[i], depositedSigningKeysCountAfter);
            nodeOperator.depositedSigningKeysCount = depositedSigningKeysCountAfter;
        }

        assert(loadedKeysCount == _keysCountToLoad);
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

        NodeOperator memory nodeOperator = _nodeOperators[_nodeOperatorId];

        active = nodeOperator.active;
        name = _fullInfo ? nodeOperator.name : ""; // reading name is 2+ SLOADs
        rewardAddress = nodeOperator.rewardAddress;

        stakingLimit = nodeOperator.vettedSigningKeysCount;
        stoppedValidators = nodeOperator.exitedSigningKeysCount;
        totalSigningKeys = nodeOperator.totalSigningKeysCount;
        usedSigningKeys = nodeOperator.depositedSigningKeysCount;
    }

    function getNodeOperatorValidatorsStats(uint256 _nodeOperatorId)
        external
        view
        returns (
            uint64 targetValidatorsCount,
            uint64 excessValidatorsCount,
            uint64 stuckValidatorsCount,
            uint64 forgivenValidatorsCount,
            uint64 stuckPenaltyEndTimestamp
        )
    {
        _onlyExistedNodeOperator(_nodeOperatorId);

        uint256 operatorTargetStats = _getOperatorTargetValidtatorsStats(_nodeOperatorId);
        uint256 stcukPenaltyStats = _getOperatorStuckPenaltyStats(_nodeOperatorId);

        targetValidatorsCount = operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET);
        excessValidatorsCount = operatorTargetStats.get(EXCESS_VALIDATORS_COUNT_OFFSET);
        stuckValidatorsCount = stcukPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET);
        forgivenValidatorsCount = stcukPenaltyStats.get(FORGIVEN_VALIDATORS_COUNT_OFFSET);
        stuckPenaltyEndTimestamp = stcukPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET);
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
        for (uint256 operatorId = 0; operatorId < nodeOperatorCount; ++operatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[operatorId];
            if (!nodeOperator.active) continue;

            uint256 activeValidatorsCount =
                nodeOperator.depositedSigningKeysCount.sub(nodeOperator.exitedSigningKeysCount);
            totalActiveValidatorsCount = totalActiveValidatorsCount.add(activeValidatorsCount);

            recipients[idx] = nodeOperator.rewardAddress;
            shares[idx] = activeValidatorsCount;

            uint256 stcukPenaltyStats = _getOperatorStuckPenaltyStats(operatorId);
            if (
                stcukPenaltyStats.get(FORGIVEN_VALIDATORS_COUNT_OFFSET)
                    < stcukPenaltyStats.get(STUCK_VALIDATORS_COUNT_OFFSET)
                    || block.timestamp <= stcukPenaltyStats.get(STUCK_PENALTY_END_TIMESTAMP_OFFSET)
            ) {
                penalized[idx] = true;
            }

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
    function addSigningKeys(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures)
        external
    {
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
    function addSigningKeysOperatorBH(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures)
        external
    {
        _addSigningKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    function _addSigningKeys(uint256 _nodeOperatorId, uint256 _keysCount, bytes _publicKeys, bytes _signatures)
        internal
    {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        require(_keysCount != 0, "NO_KEYS");
        _requireOutOfRange(_keysCount <= UINT64_MAX);

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint256 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;

        totalSigningKeysCount = SIGNING_KEYS_MAPPING_NAME._addSigningKeys(
            _nodeOperatorId, _keysCount, totalSigningKeysCount, _publicKeys, _signatures
        );

        _requireOutOfRange(totalSigningKeysCount.add(_keysCount) <= UINT64_MAX);

        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount);

        nodeOperator.totalSigningKeysCount = uint64(totalSigningKeysCount);

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats = totalSigningKeysStats.inc(TOTAL_KEYS_COUNT_OFFSET, uint64(_keysCount));
        _setTotalSigningKeysStats(totalSigningKeysStats);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Removes a validator signing key #`_index` from the keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @dev DEPRECATED use removeSigningKeys instead
    // function removeSigningKey(uint256 _nodeOperatorId, uint256 _index) external {
    //     _removeUnusedSigningKeys(_nodeOperatorId, _index, 1);
    // }

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
    /// @dev DEPRECATED use removeSigningKeysOperatorBH instead
    // function removeSigningKeyOperatorBH(uint256 _nodeOperatorId, uint256 _index) external {
    //     _removeUnusedSigningKeys(_nodeOperatorId, _index, 1);
    // }

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    // function removeSigningKeysOperatorBH(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) external {
    //     _removeUnusedSigningKeys(_nodeOperatorId, uint64(_fromIndex), uint64(_keysCount));
    // }

    function _removeUnusedSigningKeys(uint256 _nodeOperatorId, uint256 _fromIndex, uint256 _keysCount) internal {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        _requireOutOfRange(_fromIndex < UINT64_MAX);
        /// @dev safemath(unit256) checks for overflow on addition, so _keysCount is guaranteed <= UINT64_MAX
        uint256 _toIndex = _fromIndex.add(_keysCount);
        _requireOutOfRange(_toIndex <= UINT64_MAX);

        // preserve the previous behavior of the method here and just return earlier
        if (_keysCount == 0) return;

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint256 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
        require(_toIndex <= totalSigningKeysCount, "KEY_NOT_FOUND");

        uint256 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;
        require(_fromIndex >= depositedSigningKeysCount, "KEY_WAS_USED");

        // removing from the last index to the highest one, so we won't get outside the array
        for (uint256 i = _toIndex; i > _fromIndex; --i) {
            totalSigningKeysCount =
                SIGNING_KEYS_MAPPING_NAME._removeUnusedSigningKey(_nodeOperatorId, i - 1, totalSigningKeysCount.sub(1));
        }

        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats = totalSigningKeysStats.dec(TOTAL_KEYS_COUNT_OFFSET, uint64(_keysCount));
        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount);

        nodeOperator.totalSigningKeysCount = uint64(totalSigningKeysCount);

        uint64 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;

        if (_fromIndex < vettedSigningKeysCount) {
            // decreasing the staking limit so the key at _index can't be used anymore
            nodeOperator.vettedSigningKeysCount = uint64(_fromIndex);
            // totalSigningKeysStats.decreaseVettedSigningKeysCount(vettedSigningKeysCount - uint64(_fromIndex));
            totalSigningKeysStats =
                totalSigningKeysStats.dec(VETTED_KEYS_COUNT_OFFSET, vettedSigningKeysCount - uint64(_fromIndex));
            emit VettedSigningKeysCountChanged(_nodeOperatorId, _fromIndex);

            uint256 operatorTargetStats = _getOperatorTargetValidtatorsStats(_nodeOperatorId);
            if (operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET) == 0) {
                uint256 totalTargetStats = _getTotalTargetValidtatorsStats();
                totalTargetStats =
                    totalTargetStats.dec(TARGET_VALIDATORS_COUNT_OFFSET, vettedSigningKeysCount - uint64(_fromIndex));
                _setTotalValidtatorsStats(totalTargetStats);
            }
        }
        _setTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    /// @notice Returns total number of signing keys of the node operator #`_nodeOperatorId`
    function getTotalSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        return _nodeOperators[_nodeOperatorId].totalSigningKeysCount;
    }

    /// @notice Returns number of usable signing keys of the node operator #`_nodeOperatorId`
    function getUnusedSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        return _nodeOperators[_nodeOperatorId].totalSigningKeysCount.sub(
            _nodeOperators[_nodeOperatorId].depositedSigningKeysCount
        );
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
        _onlyExistedNodeOperator(_nodeOperatorId);
        require(_index < _nodeOperators[_nodeOperatorId].totalSigningKeysCount, "KEY_NOT_FOUND");

        (key, depositSignature) = SIGNING_KEYS_MAPPING_NAME._loadSigningKey(_nodeOperatorId, _index);
        used = _index < _nodeOperators[_nodeOperatorId].depositedSigningKeysCount;
    }

    /// @notice Returns a monotonically increasing counter that gets incremented when any of the following happens:
    ///   1. a node operator's key(s) is added;
    ///   2. a node operator's key(s) is removed;
    ///   3. a node operator's vetted keys count is changed.
    ///   4. a node operator was activated/deactivated. Activation or deactivation of node operator
    ///      might lead to usage of unvalidated keys in the assignNextSigningKeys method.
    function getKeysOpIndex() external view returns (uint256) {
        return KEYS_OP_INDEX_POSITION.getStorageUint256();
    }

    /// @notice Returns n signing keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _offset Offset of the key, starting with 0
    /// @param _limit Number of keys to return
    /// @return pubkeys Keys concatenated into the bytes batch
    /// @return signatures Signatures concatenated into the bytes batch needed for a deposit_contract.deposit call
    /// @return used Array of flags indicated if the key was used in the staking
    function getSigningKeys(uint256 _nodeOperatorId, uint256 _offset, uint256 _limit)
        external
        view
        returns (bytes memory pubkeys, bytes memory signatures, bool[] memory used)
    {
        _onlyExistedNodeOperator(_nodeOperatorId);
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        _requireOutOfRange(_offset.add(_limit) <= nodeOperator.totalSigningKeysCount);

        (pubkeys, signatures) = SigningKeys._initKeySig(_limit);

        used = new bool[](_limit);

        for (uint256 index = 0; index < _limit; index++) {
            SIGNING_KEYS_MAPPING_NAME._loadSigningKeyAndAppend(
                _nodeOperatorId, _offset.add(index), index, pubkeys, signatures
            );

            used[index] = (_offset.add(index)) < nodeOperator.depositedSigningKeysCount;
        }
    }

    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32) {
        return TYPE_POSITION.getStorageBytes32();
    }

    /// @notice Returns the validators stats of all node operators in the staking module
    /// @return exitedValidatorsCount Total number of validators in the EXITED state
    /// @return activeValidatorsKeysCount Total number of validators in active state
    /// @return readyToDepositValidatorsKeysCount Total number of validators ready to be deposited
    function getValidatorsKeysStats()
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {
        uint256 totalSigningKeysStats = _getTotalSigningKeysStats();
        uint256 totalTargetStats = _getTotalTargetValidtatorsStats();

        exitedValidatorsCount = totalSigningKeysStats.get(EXITED_KEYS_COUNT_OFFSET);
        activeValidatorsKeysCount = totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET) - exitedValidatorsCount;

        uint256 targetDepositedValidatorsCount =
            exitedValidatorsCount + totalTargetStats.sum(TARGET_VALIDATORS_COUNT_OFFSET, EXCESS_VALIDATORS_COUNT_OFFSET);

        if (targetDepositedValidatorsCount < totalSigningKeysStats.get(VETTED_KEYS_COUNT_OFFSET)) {
            readyToDepositValidatorsKeysCount = targetDepositedValidatorsCount
                > totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET)
                ? targetDepositedValidatorsCount - totalSigningKeysStats.get(DEPOSITED_KEYS_COUNT_OFFSET)
                : 0;
        } else {
            readyToDepositValidatorsKeysCount =
                totalSigningKeysStats.diff(VETTED_KEYS_COUNT_OFFSET, DEPOSITED_KEYS_COUNT_OFFSET);
            // totalSigningKeysStats.vettedSigningKeysCount - totalSigningKeysStats.depositedSigningKeysCount;
        }
    }

    /// @notice Returns the validators stats of given node operator
    /// @param _nodeOperatorId Node operator id to get data for
    /// @return exitedValidatorsCount Total number of validators in the EXITED state
    /// @return activeValidatorsKeysCount Total number of validators in active state
    /// @return readyToDepositValidatorsKeysCount Total number of validators ready to be deposited
    function getValidatorsKeysStats(uint256 _nodeOperatorId)
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint256 operatorTargetStats = _getOperatorTargetValidtatorsStats(_nodeOperatorId);

        uint256 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;
        uint256 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

        exitedValidatorsCount = nodeOperator.exitedSigningKeysCount;
        activeValidatorsKeysCount = depositedSigningKeysCount - exitedValidatorsCount;
        
        uint256 targetDepositedValidatorsCount = exitedValidatorsCount
            + operatorTargetStats.sum(TARGET_VALIDATORS_COUNT_OFFSET, EXCESS_VALIDATORS_COUNT_OFFSET);

        /// @todo minus penalized
        if (operatorTargetStats.get(TARGET_VALIDATORS_COUNT_OFFSET) > 0 && targetDepositedValidatorsCount < vettedSigningKeysCount) {
            readyToDepositValidatorsKeysCount = targetDepositedValidatorsCount > depositedSigningKeysCount
                ? targetDepositedValidatorsCount - depositedSigningKeysCount
                : 0;
        } else {
            readyToDepositValidatorsKeysCount = vettedSigningKeysCount - depositedSigningKeysCount;
        }
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
    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool) {
        return _nodeOperators[_nodeOperatorId].active;
    }

    /// @notice Returns a counter that MUST change it's value when any of the following happens:
    ///     1. a node operator's key(s) is added
    ///     2. a node operator's key(s) is removed
    ///     3. a node operator's ready to deposit keys count is changed
    ///     4. a node operator was activated/deactivated
    function getValidatorsKeysNonce() external view returns (uint256) {
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

        for (uint256 idx = 0; idx < recipients.length; ++idx) {
            if (shares[idx] == 0) continue;
            if (penalized[idx]) {
                /// @dev half reward punishment
                /// @dev ignore remainder since it accumulated on contract balance
                shares[idx] >>= 1;
                /// @todo transfer to burner
                stETH.burnShares(address(this), shares[idx]);
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

    function _increaseValidatorsKeysNonce() internal {
        uint256 keysOpIndex = KEYS_OP_INDEX_POSITION.getStorageUint256() + 1;
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex);
        /// @dev [DEPRECATED] event preserved for tooling compatibility
        emit KeysOpIndexSet(keysOpIndex);
        emit ValidatorsKeysNonceChanged(keysOpIndex);
    }

    function _setTotalSigningKeysStats(uint256 _val) internal {
        TOTAL_SIGNING_KEYS_STATS.setStorageUint256(_val);
    }

    function _getTotalSigningKeysStats() internal view returns (uint256) {
        return TOTAL_SIGNING_KEYS_STATS.getStorageUint256();
    }

    function _setTotalValidtatorsStats(uint256 _val) internal {
        TOTAL_VALIDATORS_STATS.setStorageUint256(_val);
    }

    function _getTotalTargetValidtatorsStats() internal view returns (uint256) {
        return TOTAL_VALIDATORS_STATS.getStorageUint256();
    }

    // load mapping value
    function _getOperatorTargetValidtatorsStats(uint256 _nodeOperatorId) internal view returns (uint256) {
        return OPERATOR_VALIDATORS_STATS_MAP.getStorageMappingUint256(_nodeOperatorId);
    }

    function _setOperatorTargetValidtatorsStats(uint256 _nodeOperatorId, uint256 _val) internal {
        OPERATOR_VALIDATORS_STATS_MAP.setStorageMappingUint256(_nodeOperatorId, _val);
    }

    function _getOperatorStuckPenaltyStats(uint256 _nodeOperatorId) internal view returns (uint256) {
        return OPERATOR_STUCK_PENALTY_STATS_MAP.getStorageMappingUint256(_nodeOperatorId);
    }

    function _setOperatorStuckPenaltyStats(uint256 _nodeOperatorId, uint256 _val) internal {
        OPERATOR_STUCK_PENALTY_STATS_MAP.setStorageMappingUint256(_nodeOperatorId, _val);
    }

    function _requireAuth(bool _pass) internal pure {
        require(_pass, "APP_AUTH_FAILED");
    }

    function _requireOutOfRange(bool _pass) internal pure {
        require(_pass, "OUT_OF_RANGE");
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
        require(_nodeOperatorId < getNodeOperatorsCount(), "OPERATOR_NOT_FOUND");
    }

    function _onlyValidNodeOperatorName(string _name) internal pure {
        require(bytes(_name).length > 0, "NAME_IS_EMPTY");
        require(bytes(_name).length <= MAX_NODE_OPERATOR_NAME_LENGTH, "NAME_TOO_LONG");
    }

    function _onlyNonZeroAddress(address _a) internal pure {
        require(_a != address(0), "ZERO_ADDRESS");
    }
}
