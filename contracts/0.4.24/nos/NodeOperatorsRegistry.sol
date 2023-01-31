// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {AragonApp} from "@aragon/os/contracts/apps/AragonApp.sol";
import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";

import {IStakingModule} from "../interfaces/IStakingModule.sol";
import {IStETH} from "../interfaces/IStETH.sol";

import {Math64} from "../lib/Math64.sol";
import {BytesLib} from "../lib/BytesLib.sol";
import {MemUtils} from "../../common/lib/MemUtils.sol";
import {MinFirstAllocationStrategy} from "../../common/lib/MinFirstAllocationStrategy.sol";
import {SigningKeysStats} from "../lib/SigningKeysStats.sol";

/// @title Node Operator registry
/// @notice Node Operator registry manages signing keys and other node operator data.
///     It's also responsible for distributing rewards to node operators.
/// NOTE: the code below assumes moderate amount of node operators, i.e. up to `MAX_NODE_OPERATORS_COUNT`.
contract NodeOperatorsRegistry is AragonApp, IStakingModule {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;
    using SigningKeysStats for SigningKeysStats.State;

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
    event SigningKeyAdded(uint256 indexed nodeOperatorId, bytes pubkey);
    event SigningKeyRemoved(uint256 indexed nodeOperatorId, bytes pubkey);
    event KeysOpIndexSet(uint256 keysOpIndex);
    event ContractVersionSet(uint256 version);
    event StakingModuleTypeSet(bytes32 moduleType);
    event RewardsDistributed(address indexed rewardAddress, uint256 sharesAmount);
    event StethContractSet(address stethAddress);
    event VettedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 approvedValidatorsCount);
    event DepositedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 depositedValidatorsCount);
    event ExitedSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 exitedValidatorsCount);
    event TotalSigningKeysCountChanged(uint256 indexed nodeOperatorId, uint256 totalValidatorsCount);

    //
    // ACL
    //
    bytes32 public constant MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 public constant ADD_NODE_OPERATOR_ROLE = keccak256("ADD_NODE_OPERATOR_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_NAME_ROLE = keccak256("SET_NODE_OPERATOR_NAME_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_ADDRESS_ROLE = keccak256("SET_NODE_OPERATOR_ADDRESS_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE = keccak256("SET_NODE_OPERATOR_LIMIT_ROLE");
    bytes32 public constant REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE = keccak256("REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE");
    bytes32 public constant INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE = keccak256("INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE");
    bytes32 public constant ACTIVATE_NODE_OPERATOR_ROLE = keccak256("ACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant DEACTIVATE_NODE_OPERATOR_ROLE = keccak256("DEACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant STAKING_ROUTER_ROLE = keccak256("STAKING_ROUTER_ROLE");

    //
    // CONSTANTS
    //
    uint256 public constant MAX_NODE_OPERATORS_COUNT = 200;
    uint256 public constant MAX_NODE_OPERATOR_NAME_LENGTH = 255;

    uint64 private constant PUBKEY_LENGTH = 48;
    uint64 private constant SIGNATURE_LENGTH = 96;
    uint256 internal constant UINT64_MAX = uint256(uint64(-1));

    //
    // UNSTRUCTURED STORAGE POSITIONS
    //
    bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = keccak256("lido.NodeOperatorsRegistry.signingKeysMappingName");

    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.NodeOperatorsRegistry.contractVersion");

    bytes32 internal constant STETH_POSITION = keccak256("lido.NodeOperatorsRegistry.stETH");

    /// @dev Total number of operators
    bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.totalOperatorsCount");

    /// @dev Cached number of active operators
    bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.activeOperatorsCount");

    /// @dev link to the index of operations with keys
    bytes32 internal constant KEYS_OP_INDEX_POSITION = keccak256("lido.NodeOperatorsRegistry.keysOpIndex");

    /// @dev module type
    bytes32 internal constant TYPE_POSITION = keccak256("lido.NodeOperatorsRegistry.type");

    bytes32 internal constant TOTAL_SIGNING_KEYS_STATS = keccak256("lido.NodeOperatorsRegistry.totalSigningKeysStats");

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

    function initialize(address _steth, bytes32 _type) public onlyInit {
        // Initializations for v1 --> v2
        _initialize_v2(_steth, _type);
        initialized();
    }

    /// @notice A function to finalize upgrade to v2 (from v1). Can be called only once
    /// @dev Value 1 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
    /// For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
    function finalizeUpgrade_v2(address _steth, bytes32 _type) external {
        require(!isPetrified(), "PETRIFIED");
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "WRONG_BASE_VERSION");
        _initialize_v2(_steth, _type);

        uint256 totalOperators = getNodeOperatorsCount();
        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        for (uint256 operatorId = 0; operatorId < totalOperators; ++operatorId) {
            NodeOperator storage operator = _nodeOperators[operatorId];

            uint64 totalSigningKeysCount = operator.totalSigningKeysCount;
            uint64 vettedSigningKeysCount = operator.vettedSigningKeysCount;
            uint64 depositedSigningKeysCount = operator.depositedSigningKeysCount;
            uint64 exitedSigningKeysCount = operator.exitedSigningKeysCount;

            uint64 vettedSigningKeysCountBefore = vettedSigningKeysCount;
            uint64 vettedSigningKeysCountAfter = Math64.min(
                totalSigningKeysCount,
                Math64.max(depositedSigningKeysCount, vettedSigningKeysCountBefore)
            );

            if (!operator.active) {
                // trim vetted signing keys count when node operator is not active
                vettedSigningKeysCountAfter = depositedSigningKeysCount;
            }

            if (vettedSigningKeysCountBefore != vettedSigningKeysCountAfter) {
                _nodeOperators[operatorId].vettedSigningKeysCount = vettedSigningKeysCountAfter;
                emit VettedSigningKeysCountChanged(operatorId, vettedSigningKeysCountAfter);
            }
            totalSigningKeysStats.increaseVettedSigningKeysCount(vettedSigningKeysCountAfter);
            totalSigningKeysStats.increaseDepositedSigningKeysCount(depositedSigningKeysCount);
            totalSigningKeysStats.increaseExitedSigningKeysCount(exitedSigningKeysCount);
            totalSigningKeysStats.increaseTotalSigningKeysCount(totalSigningKeysCount);
        }
        _setTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    function _initialize_v2(address _steth, bytes32 _type) internal {
        require(_steth != address(0), "STETH_ADDRESS_ZERO");
        STETH_POSITION.setStorageAddress(_steth);
        TYPE_POSITION.setStorageBytes32(_type);

        CONTRACT_VERSION_POSITION.setStorageUint256(2);
        emit ContractVersionSet(2);
        emit StethContractSet(_steth);
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
        require(id < MAX_NODE_OPERATORS_COUNT, "MAX_NODE_OPERATORS_COUNT_EXCEEDED");

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
        require(!nodeOperator.active, "NODE_OPERATOR_ALREADY_ACTIVATED");

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
        require(nodeOperator.active, "NODE_OPERATOR_ALREADY_DEACTIVATED");

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

            SigningKeysStats.State memory totalValidatorStats = _getTotalSigningKeysStats();
            totalValidatorStats.decreaseVettedSigningKeysCount(vettedSigningKeysCount - depositedSigningKeysCount);
            _setTotalSigningKeysStats(totalValidatorStats);
        }
        _increaseValidatorsKeysNonce();
    }

    /// @notice Change human-readable name of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set name for
    /// @param _name New human-readable name of the node operator
    function setNodeOperatorName(uint256 _nodeOperatorId, string _name) external {
        _onlyValidNodeOperatorName(_name);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _authP(SET_NODE_OPERATOR_NAME_ROLE, arr(uint256(_nodeOperatorId)));

        require(keccak256(_nodeOperators[_nodeOperatorId].name) != keccak256(_name), "NODE_OPERATOR_NAME_IS_THE_SAME");
        _nodeOperators[_nodeOperatorId].name = _name;
        emit NodeOperatorNameSet(_nodeOperatorId, _name);
    }

    /// @notice Change reward address of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _rewardAddress Execution layer Ethereum address to set as reward address
    function setNodeOperatorRewardAddress(uint256 _nodeOperatorId, address _rewardAddress) external {
        _onlyNonZeroAddress(_rewardAddress);
        _onlyExistedNodeOperator(_nodeOperatorId);
        _authP(SET_NODE_OPERATOR_ADDRESS_ROLE, arr(uint256(_nodeOperatorId), uint256(_rewardAddress)));

        require(_nodeOperators[_nodeOperatorId].rewardAddress != _rewardAddress, "NODE_OPERATOR_ADDRESS_IS_THE_SAME");
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
        require(nodeOperator.active, "NODE_OPERATOR_DEACTIVATED");

        uint64 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
        uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;
        uint64 vettedSigningKeysCountBefore = nodeOperator.vettedSigningKeysCount;

        uint64 vettedSigningKeysCountAfter = Math64.min(
            totalSigningKeysCount,
            Math64.max(_vettedSigningKeysCount, depositedSigningKeysCount)
        );

        if (vettedSigningKeysCountAfter == vettedSigningKeysCountBefore) {
            return;
        }

        nodeOperator.vettedSigningKeysCount = vettedSigningKeysCountAfter;

        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        if (vettedSigningKeysCountAfter > vettedSigningKeysCountBefore) {
            totalSigningKeysStats.increaseVettedSigningKeysCount(vettedSigningKeysCountAfter - vettedSigningKeysCountBefore);
        } else {
            totalSigningKeysStats.decreaseVettedSigningKeysCount(vettedSigningKeysCountBefore - vettedSigningKeysCountAfter);
        }
        _setTotalSigningKeysStats(totalSigningKeysStats);

        emit VettedSigningKeysCountChanged(_nodeOperatorId, vettedSigningKeysCountAfter);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Called by StakingRouter to signal that stETH rewards were minted for this module.
    /// @param _totalShares Amount of shares that were minted to reward all node operators.
    function handleRewardsMinted(uint256 _totalShares)
        external
        auth(STAKING_ROUTER_ROLE)
    {
        // since we're pushing rewards to operators after exited validators counts are
        // updated (as opposed to pulling by node ops), we don't need any handling here
    }

    /// @notice Updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    /// @return Total number of exited validators across all node operators.
    function updateExitedValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsKeysCount)
        external
        returns (uint256)
    {
        return _updateExitedValidatorsKeysCount(_nodeOperatorId, _exitedValidatorsKeysCount, false);
    }

    /// @notice Called by StakingRouter after oracle finishes updating exited keys counts for all operators.
    function finishUpdatingExitedValidatorsKeysCount()
        external
        auth(STAKING_ROUTER_ROLE)
    {
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
    function unsafeUpdateExitedValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsKeysCount)
        external
        returns (uint256)
    {
        return _updateExitedValidatorsKeysCount(_nodeOperatorId, _exitedValidatorsKeysCount, true);
    }

    function _updateExitedValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsKeysCount,
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
        require(_allowDecrease || _exitedValidatorsKeysCount > exitedValidatorsCountBefore, "EXITED_VALIDATORS_COUNT_DECREASED");

        _nodeOperators[_nodeOperatorId].exitedSigningKeysCount = uint64(_exitedValidatorsKeysCount);

        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        if (_exitedValidatorsKeysCount > exitedValidatorsCountBefore) {
            totalSigningKeysStats.increaseExitedSigningKeysCount(uint64(_exitedValidatorsKeysCount) - exitedValidatorsCountBefore);
        } else {
            totalSigningKeysStats.decreaseExitedSigningKeysCount(exitedValidatorsCountBefore - uint64(_exitedValidatorsKeysCount));
        }
        _setTotalSigningKeysStats(totalSigningKeysStats);

        emit ExitedSigningKeysCountChanged(_nodeOperatorId, _exitedValidatorsKeysCount);

        return totalSigningKeysStats.exitedSigningKeysCount;
    }

    /// @notice Invalidates all unused validators keys for all node operators
    function invalidateReadyToDepositKeys() external {
        _auth(INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE);

        bool wereSigningKeysTrimmed = false;
        uint256 nodeOperatorsCount = getNodeOperatorsCount();

        for (uint256 _nodeOperatorId = 0; _nodeOperatorId < nodeOperatorsCount; ++_nodeOperatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
            uint64 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
            uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

            if (depositedSigningKeysCount == totalSigningKeysCount) {
                continue;
            }

            nodeOperator.totalSigningKeysCount = depositedSigningKeysCount;
            nodeOperator.vettedSigningKeysCount = depositedSigningKeysCount;

            emit TotalSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);
            emit VettedSigningKeysCountChanged(_nodeOperatorId, depositedSigningKeysCount);
            emit NodeOperatorTotalKeysTrimmed(_nodeOperatorId, totalSigningKeysCount - depositedSigningKeysCount);

            if (!wereSigningKeysTrimmed) {
                wereSigningKeysTrimmed = true;
            }
        }

        if (wereSigningKeysTrimmed) {
            SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();

            totalSigningKeysStats.totalSigningKeysCount = totalSigningKeysStats.depositedSigningKeysCount;
            totalSigningKeysStats.vettedSigningKeysCount = totalSigningKeysStats.depositedSigningKeysCount;

            _setTotalSigningKeysStats(totalSigningKeysStats);

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
        returns (
            uint256 enqueuedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        _auth(REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE);

        uint256[] memory nodeOperatorIds;
        uint256[] memory activeKeysCountAfterAllocation;
        uint256[] memory exitedSigningKeysCount;
        (
            enqueuedValidatorsKeysCount,
            nodeOperatorIds,
            activeKeysCountAfterAllocation,
            exitedSigningKeysCount
        ) = _getSigningKeysAllocationData(_keysCount);

        if (enqueuedValidatorsKeysCount == 0) {
            return (0, new bytes(0), new bytes(0));
        }

        (publicKeys, signatures) = _loadAllocatedSigningKeys(
            enqueuedValidatorsKeysCount,
            nodeOperatorIds,
            activeKeysCountAfterAllocation,
            exitedSigningKeysCount
        );

        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats.increaseDepositedSigningKeysCount(uint64(enqueuedValidatorsKeysCount));
        _setTotalSigningKeysStats(totalSigningKeysStats);
        _increaseValidatorsKeysNonce();
    }

    function _getSigningKeysAllocationData(uint256 _keysCount)
        internal
        view
        returns (
            uint256 allocatedKeysCount,
            uint256[] memory nodeOperatorIds,
            uint256[] memory activeKeyCountsAfterAllocation,
            uint256[] memory exitedSigningKeysCount
        )
    {
        uint256 activeNodeOperatorsCount = getActiveNodeOperatorsCount();
        nodeOperatorIds = new uint256[](activeNodeOperatorsCount);
        activeKeyCountsAfterAllocation = new uint256[](activeNodeOperatorsCount);
        exitedSigningKeysCount = new uint256[](activeNodeOperatorsCount);
        uint256[] memory activeKeysCapacities = new uint256[](activeNodeOperatorsCount);

        uint256 activeNodeOperatorIndex;
        uint256 nodeOperatorsCount = getNodeOperatorsCount();
        for (uint256 nodeOperatorId = 0; nodeOperatorId < nodeOperatorsCount; ++nodeOperatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[nodeOperatorId];
            if (!nodeOperator.active) continue;

            nodeOperatorIds[activeNodeOperatorIndex] = nodeOperatorId;
            exitedSigningKeysCount[activeNodeOperatorIndex] = nodeOperator.exitedSigningKeysCount;
            uint256 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;
            uint256 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;

            // the node operator has no available signing keys
            if (depositedSigningKeysCount == vettedSigningKeysCount) continue;

            activeKeyCountsAfterAllocation[activeNodeOperatorIndex] = depositedSigningKeysCount.sub(
                exitedSigningKeysCount[activeNodeOperatorIndex]
            );
            activeKeysCapacities[activeNodeOperatorIndex] = vettedSigningKeysCount.sub(exitedSigningKeysCount[activeNodeOperatorIndex]);

            ++activeNodeOperatorIndex;
        }

        if (activeNodeOperatorIndex == 0) return (0, new uint256[](0), new uint256[](0), new uint256[](0));

        /// @dev shrink the length of the resulting arrays if some active node operators have no available keys to be deposited
        if (activeNodeOperatorIndex < activeNodeOperatorsCount) {
            assembly {
                mstore(nodeOperatorIds, activeNodeOperatorIndex)
                mstore(activeKeyCountsAfterAllocation, activeNodeOperatorIndex)
                mstore(exitedSigningKeysCount, activeNodeOperatorIndex)
                mstore(activeKeysCapacities, activeNodeOperatorIndex)
            }
        }

        allocatedKeysCount = MinFirstAllocationStrategy.allocate(activeKeyCountsAfterAllocation, activeKeysCapacities, _keysCount);

        assert(allocatedKeysCount <= _keysCount);
    }

    function _loadAllocatedSigningKeys(
        uint256 _keysCountToLoad,
        uint256[] memory _nodeOperatorIds,
        uint256[] memory _activeKeyCountsAfterAllocation,
        uint256[] memory _exitedSigningKeysCount
    ) internal returns (bytes memory publicKeys, bytes memory signatures) {
        publicKeys = MemUtils.unsafeAllocateBytes(_keysCountToLoad * PUBKEY_LENGTH);
        signatures = MemUtils.unsafeAllocateBytes(_keysCountToLoad * SIGNATURE_LENGTH);

        uint256 loadedKeysCount = 0;
        uint64 depositedSigningKeysCountBefore;
        uint64 depositedSigningKeysCountAfter;
        bytes memory pubkey;
        bytes memory signature;
        uint256 keyIndex;
        for (uint256 i = 0; i < _nodeOperatorIds.length; ++i) {
            NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorIds[i]];

            depositedSigningKeysCountBefore = nodeOperator.depositedSigningKeysCount;
            depositedSigningKeysCountAfter = uint64(_exitedSigningKeysCount[i].add(_activeKeyCountsAfterAllocation[i]));

            if (depositedSigningKeysCountBefore == depositedSigningKeysCountAfter) continue;

            for (keyIndex = depositedSigningKeysCountBefore; keyIndex < depositedSigningKeysCountAfter; ++keyIndex) {
                (pubkey, signature) = _loadSigningKey(_nodeOperatorIds[i], keyIndex);
                MemUtils.copyBytes(pubkey, publicKeys, loadedKeysCount * PUBKEY_LENGTH);
                MemUtils.copyBytes(signature, signatures, loadedKeysCount * SIGNATURE_LENGTH);
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

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        active = nodeOperator.active;
        name = _fullInfo ? nodeOperator.name : ""; // reading name is 2+ SLOADs
        rewardAddress = nodeOperator.rewardAddress;

        stakingLimit = nodeOperator.vettedSigningKeysCount;
        stoppedValidators = nodeOperator.exitedSigningKeysCount;
        totalSigningKeys = nodeOperator.totalSigningKeysCount;
        usedSigningKeys = nodeOperator.depositedSigningKeysCount;
    }

    /// @notice Returns the rewards distribution proportional to the effective stake for each node operator.
    /// @param _totalRewardShares Total amount of reward shares to distribute.
    function getRewardsDistribution(uint256 _totalRewardShares) public view returns (address[] memory recipients, uint256[] memory shares) {
        uint256 nodeOperatorCount = getNodeOperatorsCount();

        uint256 activeCount = getActiveNodeOperatorsCount();
        recipients = new address[](activeCount);
        shares = new uint256[](activeCount);
        uint256 idx = 0;

        uint256 totalActiveValidatorsCount = 0;
        for (uint256 operatorId = 0; operatorId < nodeOperatorCount; ++operatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[operatorId];
            if (!nodeOperator.active) continue;

            uint256 activeValidatorsCount = nodeOperator.depositedSigningKeysCount.sub(nodeOperator.exitedSigningKeysCount);
            totalActiveValidatorsCount = totalActiveValidatorsCount.add(activeValidatorsCount);

            recipients[idx] = nodeOperator.rewardAddress;
            shares[idx] = activeValidatorsCount;

            ++idx;
        }

        if (totalActiveValidatorsCount == 0) return (recipients, shares);

        uint256 perValidatorReward = _totalRewardShares.div(totalActiveValidatorsCount);

        for (idx = 0; idx < activeCount; ++idx) {
            shares[idx] = shares[idx].mul(perValidatorReward);
        }

        return (recipients, shares);
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
    function addSigningKeys(
        uint256 _nodeOperatorId,
        uint256 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) external {
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
    function addSigningKeysOperatorBH(
        uint256 _nodeOperatorId,
        uint256 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) external {
        _addSigningKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    function _addSigningKeys(
        uint256 _nodeOperatorId,
        uint256 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) internal {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        require(_keysCount != 0, "NO_KEYS");
        require(_keysCount <= UINT64_MAX, "KEYS_COUNT_TOO_LARGE");
        require(_publicKeys.length == _keysCount.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _keysCount.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint64 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
        bytes memory key;
        bytes memory sig;
        for (uint256 i = 0; i < _keysCount; ++i) {
            key = BytesLib.slice(_publicKeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeSigningKey(_nodeOperatorId, totalSigningKeysCount, key, sig);
            totalSigningKeysCount = totalSigningKeysCount.add(1);
            emit SigningKeyAdded(_nodeOperatorId, key);
        }

        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount);

        nodeOperator.totalSigningKeysCount = totalSigningKeysCount;

        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats.increaseTotalSigningKeysCount(uint64(_keysCount));
        _setTotalSigningKeysStats(totalSigningKeysStats);
        _increaseValidatorsKeysNonce();
    }

    /// @notice Removes a validator signing key #`_index` from the keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @dev DEPRECATED use removeSigningKeys instead
    function removeSigningKey(uint256 _nodeOperatorId, uint256 _index) external {
        require(_index <= UINT64_MAX, "INDEX_TOO_LARGE");
        _removeUnusedSigningKeys(_nodeOperatorId, uint64(_index), 1);
    }

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    function removeSigningKeys(
        uint256 _nodeOperatorId,
        uint256 _fromIndex,
        uint256 _keysCount
    ) external {
        require(_fromIndex <= UINT64_MAX, "FROM_INDEX_TOO_LARGE");
        /// @dev safemath(unit256) checks for overflow on addition, so _keysCount is guaranteed <= UINT64_MAX
        require(uint256(_fromIndex).add(_keysCount) <= UINT64_MAX, "KEYS_COUNT_TOO_LARGE");
        _removeUnusedSigningKeys(_nodeOperatorId, uint64(_fromIndex), uint64(_keysCount));
    }

    /// @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    /// @dev DEPRECATED use removeSigningKeysOperatorBH instead
    function removeSigningKeyOperatorBH(uint256 _nodeOperatorId, uint256 _index) external {
        require(_index <= UINT64_MAX, "INDEX_TOO_LARGE");
        _removeUnusedSigningKeys(_nodeOperatorId, uint64(_index), 1);
    }

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    function removeSigningKeysOperatorBH(
        uint256 _nodeOperatorId,
        uint256 _fromIndex,
        uint256 _keysCount
    ) external {
        require(_fromIndex <= UINT64_MAX, "FROM_INDEX_TOO_LARGE");
        /// @dev safemath(unit256) checks for overflow on addition, so _keysCount is guaranteed <= UINT64_MAX
        require(uint256(_fromIndex).add(_keysCount) <= UINT64_MAX, "KEYS_COUNT_TOO_LARGE");
        _removeUnusedSigningKeys(_nodeOperatorId, uint64(_fromIndex), uint64(_keysCount));
    }

    function _removeUnusedSigningKeys(
        uint256 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) internal {
        _onlyExistedNodeOperator(_nodeOperatorId);
        _onlyNodeOperatorManager(msg.sender, _nodeOperatorId);

        // preserve the previous behavior of the method here and just return earlier
        if (_keysCount == 0) return;

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint64 totalSigningKeysCount = nodeOperator.totalSigningKeysCount;
        require(_fromIndex.add(_keysCount) <= totalSigningKeysCount, "KEY_NOT_FOUND");

        uint64 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;
        require(_fromIndex >= depositedSigningKeysCount, "KEY_WAS_USED");

        // removing from the last index to the highest one, so we won't get outside the array
        for (uint64 i = _fromIndex.add(_keysCount); i > _fromIndex; --i) {
            _removeUnusedSigningKey(_nodeOperatorId, i - 1);
        }

        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();
        totalSigningKeysStats.decreaseTotalSigningKeysCount(_keysCount);
        emit TotalSigningKeysCountChanged(_nodeOperatorId, totalSigningKeysCount.sub(_keysCount));

        uint64 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;

        if (_fromIndex < vettedSigningKeysCount) {
            // decreasing the staking limit so the key at _index can't be used anymore
            nodeOperator.vettedSigningKeysCount = _fromIndex;
            totalSigningKeysStats.decreaseVettedSigningKeysCount(vettedSigningKeysCount - _fromIndex);
            emit VettedSigningKeysCountChanged(_nodeOperatorId, _fromIndex);
        }
        _setTotalSigningKeysStats(totalSigningKeysStats);

        _increaseValidatorsKeysNonce();
    }

    function _removeUnusedSigningKey(uint256 _nodeOperatorId, uint64 _index) internal {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        uint64 lastValidatorKeyIndex = nodeOperator.totalSigningKeysCount.sub(1);
        (bytes memory removedKey, ) = _loadSigningKey(_nodeOperatorId, _index);

        if (_index < lastValidatorKeyIndex) {
            (bytes memory key, bytes memory signature) = _loadSigningKey(_nodeOperatorId, lastValidatorKeyIndex);
            _storeSigningKey(_nodeOperatorId, _index, key, signature);
        }

        _deleteSigningKey(_nodeOperatorId, lastValidatorKeyIndex);

        nodeOperator.totalSigningKeysCount = lastValidatorKeyIndex;
        emit SigningKeyRemoved(_nodeOperatorId, removedKey);
    }

    /// @notice Returns total number of signing keys of the node operator #`_nodeOperatorId`
    function getTotalSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        return _nodeOperators[_nodeOperatorId].totalSigningKeysCount;
    }

    /// @notice Returns number of usable signing keys of the node operator #`_nodeOperatorId`
    function getUnusedSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256) {
        _onlyExistedNodeOperator(_nodeOperatorId);
        return _nodeOperators[_nodeOperatorId].totalSigningKeysCount.sub(_nodeOperators[_nodeOperatorId].depositedSigningKeysCount);
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
        returns (
            bytes key,
            bytes depositSignature,
            bool used
        )
    {
        _onlyExistedNodeOperator(_nodeOperatorId);
        require(_index < _nodeOperators[_nodeOperatorId].totalSigningKeysCount, "KEY_NOT_FOUND");

        (bytes memory key_, bytes memory signature) = _loadSigningKey(_nodeOperatorId, _index);

        return (key_, signature, _index < _nodeOperators[_nodeOperatorId].depositedSigningKeysCount);
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
    function getSigningKeys(
        uint256 _nodeOperatorId,
        uint256 _offset,
        uint256 _limit
    )
        external
        view
        returns (
            bytes memory pubkeys,
            bytes memory signatures,
            bool[] memory used
        )
    {
        _onlyExistedNodeOperator(_nodeOperatorId);
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(_offset.add(_limit) <= nodeOperator.totalSigningKeysCount, "OUT_OF_RANGE");

        pubkeys = MemUtils.unsafeAllocateBytes(_limit.mul(PUBKEY_LENGTH));
        signatures = MemUtils.unsafeAllocateBytes(_limit.mul(SIGNATURE_LENGTH));
        used = new bool[](_limit);

        bytes memory pubkey;
        bytes memory signature;
        for (uint256 index = 0; index < _limit; index++) {
            (pubkey, signature) = _loadSigningKey(_nodeOperatorId, _offset.add(index));
            MemUtils.copyBytes(pubkey, pubkeys, index.mul(PUBKEY_LENGTH));
            MemUtils.copyBytes(signature, signatures, index.mul(SIGNATURE_LENGTH));
            used[index] = (_offset.add(index)) < nodeOperator.depositedSigningKeysCount;
        }
    }

    /// @notice Return the initialized version of this contract starting from 0
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
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
        SigningKeysStats.State memory totalSigningKeysStats = _getTotalSigningKeysStats();

        uint256 vettedSigningKeysCount = totalSigningKeysStats.vettedSigningKeysCount;
        uint256 depositedSigningKeysCount = totalSigningKeysStats.depositedSigningKeysCount;

        exitedValidatorsCount = totalSigningKeysStats.exitedSigningKeysCount;
        activeValidatorsKeysCount = depositedSigningKeysCount.sub(exitedValidatorsCount);
        readyToDepositValidatorsKeysCount = vettedSigningKeysCount.sub(depositedSigningKeysCount);
    }

    /// @notice Returns the validators stats of given node operator
    /// @param _nodeOperatorId Node operator id to get data for
    /// @return exitedValidatorsCount Total number of validators in the EXITED state
    /// @return activeValidatorsKeysCount Total number of validators in active state
    /// @return readyToDepositValidatorsKeysCount Total number of validators ready to be deposited
    function getValidatorsKeysStats(uint256 _nodeOperatorId)
        public
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        uint256 vettedSigningKeysCount = nodeOperator.vettedSigningKeysCount;
        uint256 depositedSigningKeysCount = nodeOperator.depositedSigningKeysCount;

        exitedValidatorsCount = nodeOperator.exitedSigningKeysCount;
        activeValidatorsKeysCount = depositedSigningKeysCount - exitedValidatorsCount;
        readyToDepositValidatorsKeysCount = vettedSigningKeysCount - depositedSigningKeysCount;
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
        IStETH stETH = IStETH(STETH_POSITION.getStorageAddress());

        uint256 sharesToDistribute = stETH.sharesOf(address(this));
        if (sharesToDistribute == 0) {
            return;
        }

        (address[] memory recipients, uint256[] memory shares) = getRewardsDistribution(sharesToDistribute);

        distributed = 0;
        for (uint256 idx = 0; idx < recipients.length; ++idx) {
            if (shares[idx] == 0) continue;
            stETH.transferShares(recipients[idx], shares[idx]);
            distributed = distributed.add(shares[idx]);
            emit RewardsDistributed(recipients[idx], shares[idx]);
        }
    }

    function getStETH() external view returns (address) {
        return STETH_POSITION.getStorageAddress();
    }

    function _isEmptySigningKey(bytes memory _key) internal pure returns (bool) {
        assert(_key.length == PUBKEY_LENGTH);

        uint256 k1;
        uint256 k2;
        assembly {
            k1 := mload(add(_key, 0x20))
            k2 := mload(add(_key, 0x40))
        }

        return 0 == k1 && 0 == (k2 >> ((2 * 32 - PUBKEY_LENGTH) * 8));
    }

    function _signingKeyOffset(uint256 _nodeOperatorId, uint256 _keyIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SIGNING_KEYS_MAPPING_NAME, _nodeOperatorId, _keyIndex)));
    }

    function _storeSigningKey(
        uint256 _nodeOperatorId,
        uint256 _keyIndex,
        bytes memory _key,
        bytes memory _signature
    ) internal {
        assert(_key.length == PUBKEY_LENGTH);
        assert(_signature.length == SIGNATURE_LENGTH);

        // key
        uint256 offset = _signingKeyOffset(_nodeOperatorId, _keyIndex);
        uint256 keyExcessBits = (2 * 32 - PUBKEY_LENGTH) * 8;
        assembly {
            sstore(offset, mload(add(_key, 0x20)))
            sstore(add(offset, 1), shl(keyExcessBits, shr(keyExcessBits, mload(add(_key, 0x40)))))
        }
        offset += 2;

        // signature
        for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                sstore(offset, mload(add(_signature, add(0x20, i))))
            }
            offset++;
        }
    }

    function _deleteSigningKey(uint256 _nodeOperatorId, uint256 _keyIndex) internal {
        uint256 offset = _signingKeyOffset(_nodeOperatorId, _keyIndex);
        for (uint256 i = 0; i < (PUBKEY_LENGTH + SIGNATURE_LENGTH) / 32 + 1; ++i) {
            assembly {
                sstore(add(offset, i), 0)
            }
        }
    }

    function _loadSigningKey(uint256 _nodeOperatorId, uint256 _keyIndex) internal view returns (bytes memory key, bytes memory signature) {
        uint256 offset = _signingKeyOffset(_nodeOperatorId, _keyIndex);

        // key
        bytes memory tmpKey = new bytes(64);
        assembly {
            mstore(add(tmpKey, 0x20), sload(offset))
            mstore(add(tmpKey, 0x40), sload(add(offset, 1)))
        }
        offset += 2;
        key = BytesLib.slice(tmpKey, 0, PUBKEY_LENGTH);

        // signature
        signature = new bytes(SIGNATURE_LENGTH);
        for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                mstore(add(signature, add(0x20, i)), sload(offset))
            }
            offset++;
        }

        return (key, signature);
    }

    function _increaseValidatorsKeysNonce() internal {
        uint256 keysOpIndex = KEYS_OP_INDEX_POSITION.getStorageUint256() + 1;
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex);
        /// @dev [DEPRECATED] event preserved for tooling compatibility
        emit KeysOpIndexSet(keysOpIndex);
        emit ValidatorsKeysNonceChanged(keysOpIndex);
    }

    function _setTotalSigningKeysStats(SigningKeysStats.State memory _validatorsKeysStats) internal {
        _validatorsKeysStats.store(TOTAL_SIGNING_KEYS_STATS);
    }

    function _getTotalSigningKeysStats() internal view returns (SigningKeysStats.State memory) {
        return SigningKeysStats.load(TOTAL_SIGNING_KEYS_STATS);
    }

    function _auth(bytes32 _role) internal view {
        require(canPerform(msg.sender, _role, new uint256[](0)), "APP_AUTH_FAILED");
    }

    function _authP(bytes32 _role, uint256[] _params) internal view {
        require(canPerform(msg.sender, _role, _params), "APP_AUTH_FAILED");
    }

    function _onlyNodeOperatorManager(address _sender, uint256 _nodeOperatorId) internal view {
        bool isRewardAddress = _sender == _nodeOperators[_nodeOperatorId].rewardAddress;
        require(isRewardAddress || canPerform(_sender, MANAGE_SIGNING_KEYS, arr(_nodeOperatorId)), "APP_AUTH_FAILED");
    }

    function _onlyExistedNodeOperator(uint256 _nodeOperatorId) internal view {
        require(_nodeOperatorId < getNodeOperatorsCount(), "NODE_OPERATOR_NOT_FOUND");
    }

    function _onlyValidNodeOperatorName(string _name) internal pure {
        require(bytes(_name).length > 0, "NAME_IS_EMPTY");
        require(bytes(_name).length <= MAX_NODE_OPERATOR_NAME_LENGTH, "NAME_TOO_LONG");
    }

    function _onlyNonZeroAddress(address _a) internal pure {
        require(_a != address(0), "ZERO_ADDRESS");
    }
}
