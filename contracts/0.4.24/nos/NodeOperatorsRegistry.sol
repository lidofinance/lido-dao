// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {AragonApp} from "@aragon/os/contracts/apps/AragonApp.sol";
import {SafeMath} from "@aragon/os/contracts/lib/math/SafeMath.sol";
import {SafeMath64} from "@aragon/os/contracts/lib/math/SafeMath64.sol";
import {UnstructuredStorage} from "@aragon/os/contracts/common/UnstructuredStorage.sol";
import {BytesLib} from "solidity-bytes-utils/contracts/BytesLib.sol";

import {IStakingModule} from "../interfaces/IStakingModule.sol";
import {INodeOperatorsRegistry} from "../interfaces/INodeOperatorsRegistry.sol";
import {IStETH} from "../interfaces/IStETH.sol";

import "../lib/MemUtils.sol";
import {Math64} from "../../common/lib/Math64.sol";
import {MinFirstAllocationStrategy} from "../../common/lib/MinFirstAllocationStrategy.sol";
import {ValidatorsKeysStats} from "../lib/ValidatorsKeysStats.sol";

/**
 * @title Node Operator registry implementation
 *
 * See the comment of `INodeOperatorsRegistry`.
 *
 * NOTE: the code below assumes moderate amount of node operators, i.e. up to `MAX_NODE_OPERATORS_COUNT`.

 * TODO: rename to CuratedValidatorsRegistry
 */
contract NodeOperatorsRegistry is INodeOperatorsRegistry, AragonApp, IStakingModule {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;
    using ValidatorsKeysStats for ValidatorsKeysStats.State;

    //
    // ACL
    //
    bytes32 public constant MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 public constant ADD_NODE_OPERATOR_ROLE = keccak256("ADD_NODE_OPERATOR_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_ACTIVE_ROLE = keccak256("SET_NODE_OPERATOR_ACTIVE_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_NAME_ROLE = keccak256("SET_NODE_OPERATOR_NAME_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_ADDRESS_ROLE = keccak256("SET_NODE_OPERATOR_ADDRESS_ROLE");
    bytes32 public constant SET_NODE_OPERATOR_LIMIT_ROLE = keccak256("SET_NODE_OPERATOR_LIMIT_ROLE");
    bytes32 public constant REPORT_STOPPED_VALIDATORS_ROLE = keccak256("REPORT_STOPPED_VALIDATORS_ROLE");
    bytes32 public constant ENQUEUE_APPROVED_VALIDATORS_KEYS_ROLE = keccak256("ENQUEUE_APPROVED_VALIDATORS_KEYS_ROLE");
    bytes32 public constant TRIM_UNUSED_KEYS_ROLE = keccak256("TRIM_UNUSED_KEYS_ROLE");
    bytes32 public constant ACTIVATE_NODE_OPERATOR_ROLE = keccak256("ACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant DEACTIVATE_NODE_OPERATOR_ROLE = keccak256("DEACTIVATE_NODE_OPERATOR_ROLE");
    bytes32 public constant REPORT_NODE_OPERATOR_KEYS_EXITED_ROLE = keccak256("REPORT_NODE_OPERATOR_KEYS_EXITED_ROLE");

    //
    // CONSTANTS
    //
    uint64 public constant PUBKEY_LENGTH = 48;
    uint64 public constant SIGNATURE_LENGTH = 96;
    uint256 public constant MAX_NODE_OPERATORS_COUNT = 200;
    uint256 public constant MAX_NODE_OPERATOR_NAME_LENGTH = 255;
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

    bytes32 internal constant TOTAL_VALIDATORS_KEYS_STATS = keccak256("lido.NodeOperatorsRegistry.totalValidatorsKeysStats");

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
        /// @dev Maximum number of keys for this operator to be deposited for all time
        uint64 approvedValidatorsKeysCount; // previously stakingLimit
        /// @dev Number of keys in the EXITED state for this operator for all time
        uint64 exitedValidatorsKeysCount; // previously stoppedValidators
        /// @dev Total number of keys of this operator for all time
        uint64 totalValidatorsKeysCount; // totalSigningKeys
        /// @dev Number of keys of this operator which were in DEPOSITED state for all time
        uint64 depositedValidatorsKeysCount; // usedSigningKeys
    }

    //
    // STORAGE VARIABLES
    //

    /// @dev Mapping of all node operators. Mapping is used to be able to extend the struct.
    mapping(uint256 => NodeOperator) internal _nodeOperators;

    //
    // PUBLIC & EXTERNAL METHODS
    //

    function initialize(address _steth, bytes32 _type) public onlyInit {
        // Initializations for v1 --> v2
        _initialize_v2(_steth, _type);
        initialized();
    }

    /**
     * @notice A function to finalize upgrade to v2 (from v1). Can be called only once
     * @dev Value 1 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
     * For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     */
    function finalizeUpgrade_v2(address _steth, bytes32 _type) external {
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "WRONG_BASE_VERSION");
        _initialize_v2(_steth, _type);
        _increaseValidatorsKeysNonce();
    }

    function _initialize_v2(address _steth, bytes32 _type) internal {
        require(_steth != address(0), "STETH_ADDRESS_ZERO");

        STETH_POSITION.setStorageAddress(_steth);
        TYPE_POSITION.setStorageBytes32(_type);

        uint256 totalOperators = getNodeOperatorsCount();

        ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();
        for (uint256 operatorId = 0; operatorId < totalOperators; ++operatorId) {
            NodeOperator memory operator = _nodeOperators[operatorId];

            _nodeOperators[operatorId].approvedValidatorsKeysCount = Math64.min(
                operator.totalValidatorsKeysCount,
                Math64.max(operator.depositedValidatorsKeysCount, operator.approvedValidatorsKeysCount)
            );
            totalValidatorsKeysStats.increaseApprovedValidatorsKeysCount(operator.approvedValidatorsKeysCount);
            totalValidatorsKeysStats.increaseDepositedValidatorsKeysCount(operator.depositedValidatorsKeysCount);
            totalValidatorsKeysStats.increaseExitedValidatorsKeysCount(operator.exitedValidatorsKeysCount);
            totalValidatorsKeysStats.increaseTotalValidatorsKeysCount(operator.totalValidatorsKeysCount);
        }
        _setTotalValidatorsKeysStats(totalValidatorsKeysStats);

        CONTRACT_VERSION_POSITION.setStorageUint256(2);
        emit ContractVersionSet(2);
        emit StethContractSet(_steth);
        emit StakingModuleTypeSet(_type);
    }

    /**
     * @notice Add node operator named `_name` with reward address `_rewardAddress` and staking limit = 0
     * @param _name Human-readable name
     * @param _rewardAddress Address on Execution Layer which receives stETH rewards for this operator
     * @return a unique key of the added operator
     */
    function addNodeOperator(string _name, address _rewardAddress)
        external
        auth(ADD_NODE_OPERATOR_ROLE)
        onlyValidNodeOperatorName(_name)
        onlyNonZeroAddress(_rewardAddress)
        returns (uint24 id)
    {
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

        return id;
    }

    function getNodeOperatorIsActive(uint24 _nodeOperatorId) external view returns (bool) {
        return _nodeOperators[_nodeOperatorId].active;
    }

    function activateNodeOperator(uint24 _nodeOperatorId) external {
        _activateNodeOperator(_nodeOperatorId);
    }

    function _activateNodeOperator(uint24 _nodeOperatorId)
        internal
        onlyExistedNodeOperator(_nodeOperatorId)
        auth(ACTIVATE_NODE_OPERATOR_ROLE)
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(!nodeOperator.active, "NODE_OPERATOR_ALREADY_ACTIVATED");

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.add(1));

        nodeOperator.active = true;
        _increaseValidatorsKeysNonce();

        emit NodeOperatorActivated(_nodeOperatorId);
    }

    function deactivateNodeOperator(uint24 _nodeOperatorId) external {
        _deactivateNodeOperator(_nodeOperatorId);
    }

    function _deactivateNodeOperator(uint24 _nodeOperatorId)
        internal
        onlyExistedNodeOperator(_nodeOperatorId)
        auth(DEACTIVATE_NODE_OPERATOR_ROLE)
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(nodeOperator.active, "NODE_OPERATOR_ALREADY_DEACTIVATED");

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.sub(1));

        nodeOperator.active = false;
        _increaseValidatorsKeysNonce();

        emit NodeOperatorDeactivated(_nodeOperatorId);

        uint64 approvedValidatorsKeysCount = nodeOperator.approvedValidatorsKeysCount;
        uint64 depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;

        // reset approved keys count to the deposited validators count
        if (approvedValidatorsKeysCount > depositedValidatorsKeysCount) {
            nodeOperator.approvedValidatorsKeysCount = depositedValidatorsKeysCount;
            emit ApprovedValidatorsKeysCountChanged(_nodeOperatorId, depositedValidatorsKeysCount);

            ValidatorsKeysStats.State memory totalValidatorStats = _getTotalValidatorsKeysStats();
            totalValidatorStats.decreaseApprovedValidatorsKeysCount(approvedValidatorsKeysCount - depositedValidatorsKeysCount);
            _setTotalValidatorsKeysStats(totalValidatorStats);
        }
    }

    /**
     * @notice Change human-readable name of the node operator #`_nodeOperatorId` to `_name`
     */
    function setNodeOperatorName(uint24 _nodeOperatorId, string _name)
        public
        onlyExistedNodeOperator(_nodeOperatorId)
        onlyValidNodeOperatorName(_name)
        authP(SET_NODE_OPERATOR_NAME_ROLE, arr(uint256(_nodeOperatorId)))
    {
        require(keccak256(_nodeOperators[_nodeOperatorId].name) != keccak256(_name), "NODE_OPERATOR_NAME_IS_THE_SAME");
        _nodeOperators[_nodeOperatorId].name = _name;
        emit NodeOperatorNameSet(_nodeOperatorId, _name);
    }

    /**
     * @notice Change reward address of the node operator #`_nodeOperatorId` to `_rewardAddress`
     */
    function setNodeOperatorRewardAddress(uint24 _nodeOperatorId, address _rewardAddress)
        public
        onlyExistedNodeOperator(_nodeOperatorId)
        onlyNonZeroAddress(_rewardAddress)
        authP(SET_NODE_OPERATOR_ADDRESS_ROLE, arr(uint256(_nodeOperatorId), uint256(_rewardAddress)))
    {
        require(_nodeOperators[_nodeOperatorId].rewardAddress != _rewardAddress, "NODE_OPERATOR_ADDRESS_IS_THE_SAME");
        _nodeOperators[_nodeOperatorId].rewardAddress = _rewardAddress;
        emit NodeOperatorRewardAddressSet(_nodeOperatorId, _rewardAddress);
    }

    /**
     * @notice Set the maximum number of validators to stake for the node operator #`_nodeOperatorId` to `_stakingLimit`
     */
    function setNodeOperatorApprovedValidatorsKeysCount(uint24 _nodeOperatorId, uint64 _approvedValidatorsKeysCount)
        public
        authP(SET_NODE_OPERATOR_LIMIT_ROLE, arr(uint256(_nodeOperatorId), uint256(_approvedValidatorsKeysCount)))
        onlyExistedNodeOperator(_nodeOperatorId)
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        require(nodeOperator.active, "NODE_OPERATOR_DEACTIVATED");

        uint64 totalValidatorsKeysCount = nodeOperator.totalValidatorsKeysCount;
        uint64 depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;
        uint64 approvedValidatorsCountBefore = nodeOperator.approvedValidatorsKeysCount;

        uint64 approvedValidatorsCountAfter = Math64.min(
            totalValidatorsKeysCount,
            Math64.max(_approvedValidatorsKeysCount, depositedValidatorsKeysCount)
        );

        if (approvedValidatorsCountAfter == approvedValidatorsCountBefore) {
            return;
        }

        nodeOperator.approvedValidatorsKeysCount = approvedValidatorsCountAfter;

        ValidatorsKeysStats.State memory totalValidatorKeysStats = _getTotalValidatorsKeysStats();
        if (approvedValidatorsCountAfter > approvedValidatorsCountBefore) {
            totalValidatorKeysStats.increaseApprovedValidatorsKeysCount(approvedValidatorsCountAfter - approvedValidatorsCountBefore);
        } else {
            totalValidatorKeysStats.decreaseApprovedValidatorsKeysCount(approvedValidatorsCountBefore - approvedValidatorsCountAfter);
        }
        _setTotalValidatorsKeysStats(totalValidatorKeysStats);
        _increaseValidatorsKeysNonce();

        emit ApprovedValidatorsKeysCountChanged(_nodeOperatorId, approvedValidatorsCountAfter);
    }

    /**
     * @notice Report `_stoppedIncrement` more stopped validators of the node operator #`_nodeOperatorId`
        TODO:: Add method to unsafe tune node operator
     */
    function updateNodeOperatorExitedValidatorsCount(uint24 _nodeOperatorId, uint64 _exitedValidatorsCount)
        public
        onlyExistedNodeOperator(_nodeOperatorId)
        auth(REPORT_NODE_OPERATOR_KEYS_EXITED_ROLE)
    {
        uint64 exitedValidatorsCountBefore = _nodeOperators[_nodeOperatorId].exitedValidatorsKeysCount;
        uint64 depositedValidatorsKeysCount = _nodeOperators[_nodeOperatorId].depositedValidatorsKeysCount;

        if (exitedValidatorsCountBefore == _exitedValidatorsCount) {
            return;
        }

        require(_exitedValidatorsCount <= depositedValidatorsKeysCount, "INVALID_EXITED_VALIDATORS_COUNT");
        require(_exitedValidatorsCount > exitedValidatorsCountBefore, "EXITED_VALIDATORS_COUNT_DECREASED");

        _nodeOperators[_nodeOperatorId].exitedValidatorsKeysCount = _exitedValidatorsCount;

        ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();
        totalValidatorsKeysStats.increaseExitedValidatorsKeysCount(_exitedValidatorsCount - exitedValidatorsCountBefore);
        _setTotalValidatorsKeysStats(totalValidatorsKeysStats);

        emit ExitedValidatorsKeysCountChanged(_nodeOperatorId, _exitedValidatorsCount);
    }

    /**
     * @notice Remove unused keys
     * @dev Supposed to be called externally on withdrawals credentials change
     */
    function trimUnusedValidatorsKeys() external auth(TRIM_UNUSED_KEYS_ROLE) {
        uint64 trimmedKeysCount = 0;
        uint64 totalTrimmedKeysCount = 0;
        uint64 approvedValidatorsDecrease = 0;
        uint24 nodeOperatorsCount = getNodeOperatorsCount();

        for (uint24 _nodeOperatorId = 0; _nodeOperatorId < nodeOperatorsCount; ++_nodeOperatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
            uint64 totalValidatorsKeysCount = nodeOperator.totalValidatorsKeysCount;
            uint64 approvedValidatorsKeysCount = nodeOperator.approvedValidatorsKeysCount;
            uint64 depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;

            if (depositedValidatorsKeysCount == totalValidatorsKeysCount) {
                return;
            }

            totalTrimmedKeysCount += totalValidatorsKeysCount - depositedValidatorsKeysCount;
            approvedValidatorsDecrease += approvedValidatorsKeysCount - depositedValidatorsKeysCount;

            nodeOperator.totalValidatorsKeysCount = depositedValidatorsKeysCount;
            nodeOperator.approvedValidatorsKeysCount = depositedValidatorsKeysCount;

            emit TotalValidatorsKeysCountChanged(_nodeOperatorId, depositedValidatorsKeysCount);
            emit ApprovedValidatorsKeysCountChanged(_nodeOperatorId, depositedValidatorsKeysCount);
            emit NodeOperatorUnusedValidatorsKeysTrimmed(_nodeOperatorId, trimmedKeysCount);
        }

        if (totalTrimmedKeysCount > 0) {
            ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();

            totalValidatorsKeysStats.decreaseTotalValidatorsKeysCount(totalTrimmedKeysCount);
            totalValidatorsKeysStats.decreaseApprovedValidatorsKeysCount(approvedValidatorsDecrease);

            _setTotalValidatorsKeysStats(totalValidatorsKeysStats);
            _increaseValidatorsKeysNonce();

            /// @dev DEPRECATED
            emit NodeOperatorTotalKeysTrimmed(_nodeOperatorId, trimmedKeysCount);
        }
    }

    /**
     * @notice Add `_keysCount` validator keys of operator #`_nodeOperatorId` to the set of usable keys. Concatenated keys are: `_publicKeys`. Can be done by the DAO in question by using the designated rewards address.
     * @dev Along with each key the DAO has to provide a signatures for the
     *      (pubkey, withdrawal_credentials, 32000000000) message.
     *      Given that information, the contract'll be able to call
     *      deposit_contract.deposit on-chain.
     * @param _nodeOperatorId Node Operator id
     * @param _keysCount Number of keys provided
     * @param _publicKeys Several concatenated validator keys
     * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
     */
    function addValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) public {
        _addValidatorsKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    /**
     * @notice Add `_keysCount` validator keys of operator #`_nodeOperatorId` to the set of usable keys. Concatenated keys are: `_publicKeys`. Can be done by node operator in question by using the designated rewards address.
     * @dev Along with each key the DAO has to provide a signatures for the
     *      (pubkey, withdrawal_credentials, 32000000000) message.
     *      Given that information, the contract'll be able to call
     *      deposit_contract.deposit on-chain.
     * @param _nodeOperatorId Node Operator id
     * @param _keysCount Number of keys provided
     * @param _publicKeys Several concatenated validator keys
     * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
     */
    function addValidatorsKeysByNodeOperator(
        uint24 _nodeOperatorId,
        uint64 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) public {
        require(msg.sender == _nodeOperators[_nodeOperatorId].rewardAddress, "APP_AUTH_FAILED");
        _addValidatorsKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    }

    /**
     * @notice Removes an #`_keysCount` of validator keys starting from #`_fromIndex` of operator #`_nodeOperatorId` usable keys. Executed on behalf of DAO.
     * @param _nodeOperatorId Node Operator id
     * @param _fromIndex Index of the key, starting with 0
     * @param _keysCount Number of keys to remove
     */
    function removeUnusedValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) public authP(MANAGE_SIGNING_KEYS, arr(uint256(_nodeOperatorId))) {
        _removeUnusedValidatorsKeys(_nodeOperatorId, _fromIndex, _keysCount);
    }

    /**
     * @notice Removes an #`_keysCount` of validator keys starting from #`_fromIndex` of operator #`_nodeOperatorId` usable keys. Executed on behalf of Node Operator.
     * @param _nodeOperatorId Node Operator id
     * @param _fromIndex Index of the key, starting with 0
     * @param _keysCount Number of keys to remove
     */
    function removeUnusedValidatorsKeysByNodeOperator(
        uint24 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) public {
        require(msg.sender == _nodeOperators[_nodeOperatorId].rewardAddress, "APP_AUTH_FAILED");
        _removeUnusedValidatorsKeys(_nodeOperatorId, _fromIndex, _keysCount);
    }

    /**
     * @notice Returns the rewards distribution proportional to the effective stake for each node operator.
     * @param _totalRewardShares Total amount of reward shares to distribute.
     */
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

            uint256 activeValidatorsCount = nodeOperator.depositedValidatorsKeysCount.sub(nodeOperator.exitedValidatorsKeysCount);
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

    /**
     * @notice Returns number of active node operators
     */
    function getActiveNodeOperatorsCount() public view returns (uint24) {
        return uint24(ACTIVE_OPERATORS_COUNT_POSITION.getStorageUint256());
    }

    /**
     * @notice Returns the n-th node operator
     * @param _nodeOperatorId Node Operator id
     * @param _fullInfo If true, name will be returned as well
     */
    function getNodeOperator(uint24 _nodeOperatorId, bool _fullInfo)
        external
        view
        onlyExistedNodeOperator(_nodeOperatorId)
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
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        active = nodeOperator.active;
        name = _fullInfo ? nodeOperator.name : ""; // reading name is 2+ SLOADs
        rewardAddress = nodeOperator.rewardAddress;

        stakingLimit = nodeOperator.approvedValidatorsKeysCount;
        stoppedValidators = nodeOperator.exitedValidatorsKeysCount;
        totalSigningKeys = nodeOperator.totalValidatorsKeysCount;
        usedSigningKeys = nodeOperator.depositedValidatorsKeysCount;
    }

    function getNodeOperatorValidatorsStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 exitedValidatorsKeysCount,
            uint64 depositedValidatorsKeysCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        exitedValidatorsKeysCount = nodeOperator.exitedValidatorsKeysCount;
        approvedValidatorsKeysCount = nodeOperator.approvedValidatorsKeysCount;
        depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;
        totalValidatorsKeysCount = nodeOperator.totalValidatorsKeysCount;
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns n-th key of the node operator #`_nodeOperatorId`
     * @param _nodeOperatorId Node Operator id
     * @param _index Index of the key, starting with 0
     * @return key Key
     * @return depositSignature Signature needed for a deposit_contract.deposit call
     * @return used Flag indication if the key was used in the staking
     */
    function getNodeOperatorValidatorKey(uint24 _nodeOperatorId, uint256 _index)
        external
        view
        onlyExistedNodeOperator(_nodeOperatorId)
        returns (
            bytes key,
            bytes depositSignature,
            bool used
        )
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(_index < nodeOperator.totalValidatorsKeysCount, "KEY_NOT_FOUND");

        (bytes memory key_, bytes memory signature) = _loadSigningKey(_nodeOperatorId, _index);

        return (key_, signature, _index < nodeOperator.depositedValidatorsKeysCount);
    }

    function getNodeOperatorValidatorsKeys(
        uint24 _nodeOperatorId,
        uint256 _offset,
        uint256 _limit
    )
        external
        view
        onlyExistedNodeOperator(_nodeOperatorId)
        returns (
            bytes memory pubkeys,
            bytes memory signatures,
            bool[] memory used
        )
    {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        require(_offset.add(_limit) <= nodeOperator.totalValidatorsKeysCount, "OUT_OF_RANGE");

        pubkeys = MemUtils.unsafeAllocateBytes(_limit.mul(PUBKEY_LENGTH));
        signatures = MemUtils.unsafeAllocateBytes(_limit.mul(SIGNATURE_LENGTH));
        used = new bool[](_limit);

        for (uint256 index = 0; index < _limit; index++) {
            (bytes memory pubkey, bytes memory signature) = _loadSigningKey(_nodeOperatorId, _offset.add(index));
            MemUtils.copyBytes(pubkey, pubkeys, index.mul(PUBKEY_LENGTH));
            MemUtils.copyBytes(signature, signatures, index.mul(SIGNATURE_LENGTH));
            used[index] = (_offset.add(index)) < nodeOperator.depositedValidatorsKeysCount;
        }
    }

    /**
     * @notice Returns total number of node operators
     */
    function getNodeOperatorsCount() public view returns (uint24) {
        uint256 res = TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
        assert(res <= uint256(uint24(-1)));
        return uint24(res);
    }

    /**
     * @notice Returns a monotonically increasing counter that gets incremented when any of the following happens:
     *   1. a node operator's key(s) is added;
     *   2. a node operator's key(s) is removed;
     *   3. a node operator's approved keys limit is changed.
     *   4. a node operator was activated/deactivated. Activation or deactivation of node operator
     *      might lead to usage of unvalidated keys in the _assignNextSigningKeys method.
     */
    function getValidatorsKeysNonce() public view returns (uint256) {
        return KEYS_OP_INDEX_POSITION.getStorageUint256();
    }

    function getType() external view returns (bytes32) {
        return TYPE_POSITION.getStorageBytes32();
    }

    function getValidatorsStats()
        external
        view
        returns (
            uint64 exitedValidatorsKeysCount,
            uint64 depositedValidatorsKeysCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {
        ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();

        depositedValidatorsKeysCount = totalValidatorsKeysStats.depositedValidatorsKeysCount;
        exitedValidatorsKeysCount = totalValidatorsKeysStats.exitedValidatorsKeysCount;
        approvedValidatorsKeysCount = totalValidatorsKeysStats.approvedValidatorsKeysCount;
        totalValidatorsKeysCount = totalValidatorsKeysStats.totalValidatorsKeysCount;
    }

    // TODO: note that called by oracle (add this method to the end of oracle report call)
    function distributeRewards() external returns (uint256 distributed) {
        IStETH stETH = IStETH(STETH_POSITION.getStorageAddress());

        uint256 sharesToDistribute = stETH.sharesOf(address(this));
        assert(sharesToDistribute > 0);

        (address[] memory recipients, uint256[] memory shares) = getRewardsDistribution(sharesToDistribute);

        assert(recipients.length == shares.length);

        distributed = 0;
        for (uint256 idx = 0; idx < recipients.length; ++idx) {
            stETH.transferShares(recipients[idx], shares[idx]);
            distributed = distributed.add(shares[idx]);
            emit RewardsDistributedInShares(idx, shares[idx]);
        }
    }

    // TODO:: gas usage
    // TODO:: acceptance tests
    // TODO:: auditors check equivalence and ask opinion about performance
    function enqueueApprovedValidatorsKeys(uint64 _keysCount, bytes)
        external
        auth(ENQUEUE_APPROVED_VALIDATORS_KEYS_ROLE)
        returns (
            uint64 enqueuedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        uint64 activeNodeOperatorsCount = getActiveNodeOperatorsCount();
        uint24[] memory activeNodeOperatorIds = new uint24[](activeNodeOperatorsCount);
        uint256[] memory activeValidatorsKeysCountsAfter = new uint256[](activeNodeOperatorsCount);
        uint256[] memory activeValidatorsKeysCountsBefore = new uint256[](activeNodeOperatorsCount);
        uint256[] memory depositedValidatorsKeysLimits = new uint256[](activeNodeOperatorsCount);

        uint24 activeNodeOperatorIndex;
        uint64 nodeOperatorsCount = getNodeOperatorsCount();
        for (uint24 nodeOperatorId = 0; nodeOperatorId < nodeOperatorsCount; ++nodeOperatorId) {
            NodeOperator storage nodeOperator = _nodeOperators[nodeOperatorId];

            if (!nodeOperator.active) continue;

            activeNodeOperatorIds[activeNodeOperatorIndex] = nodeOperatorId;

            uint256 exitedValidatorsKeysCount = nodeOperator.exitedValidatorsKeysCount;
            uint256 depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;
            uint256 approvedValidatorsKeysCount = nodeOperator.approvedValidatorsKeysCount;

            uint256 activeValidatorsKeysCount = depositedValidatorsKeysCount - exitedValidatorsKeysCount;
            uint256 depositedValidatorsKeysLimit = approvedValidatorsKeysCount - exitedValidatorsKeysCount;

            activeValidatorsKeysCountsBefore[activeNodeOperatorIndex] = activeValidatorsKeysCount;
            activeValidatorsKeysCountsAfter[activeNodeOperatorIndex] = activeValidatorsKeysCount;
            depositedValidatorsKeysLimits[activeNodeOperatorIndex] = depositedValidatorsKeysLimit;

            ++activeNodeOperatorIndex;
        }
        enqueuedValidatorsKeysCount = _allocateNextKeys(_keysCount, activeValidatorsKeysCountsAfter, depositedValidatorsKeysLimits);
        if (enqueuedValidatorsKeysCount == 0) {
            return (0, new bytes(0), new bytes(0));
        }

        (publicKeys, signatures) = _loadNextKeys(
            _keysCount,
            activeNodeOperatorIds,
            activeValidatorsKeysCountsBefore,
            activeValidatorsKeysCountsAfter
        );
    }

    function _getActiveNodeOperatorIds() internal view returns (uint24[] memory activeNodeOperatorIds) {
        uint64 nodeOperatorsCount = getNodeOperatorsCount();
        uint64 activeNodeOperatorsCount = getActiveNodeOperatorsCount();

        activeNodeOperatorIds = new uint24[](activeNodeOperatorsCount);
        uint24 activeNodeOperatorIndex = 0;
        for (uint24 nodeOperatorId = 0; nodeOperatorId < nodeOperatorsCount; ++nodeOperatorId) {
            if (!_nodeOperators[nodeOperatorId].active) continue;

            activeNodeOperatorIds[activeNodeOperatorIndex] = nodeOperatorId;
        }
    }

    //
    // INTERNAL METHODS
    //

    function _allocateNextKeys(
        uint64 _keysCount,
        uint256[] memory activeNodeOperatorEverDepositedKeysCounts,
        uint256[] memory activeNodeOperatorEverDepositedKeysLimits
    ) internal pure returns (uint64) {
        uint256 allocatedKeysCount = MinFirstAllocationStrategy.allocate(
            activeNodeOperatorEverDepositedKeysCounts,
            activeNodeOperatorEverDepositedKeysLimits,
            _keysCount
        );
        assert(allocatedKeysCount <= _keysCount);
        return uint64(allocatedKeysCount);
    }

    function _loadNextKeys(
        uint64 _keysCount,
        uint24[] memory activeNodeOperatorIds,
        uint256[] memory activeValidatorsKeysCountsBefore,
        uint256[] memory activeValidatorsKeysCountsAfter
    ) internal returns (bytes memory publicKeys, bytes memory signatures) {
        publicKeys = MemUtils.unsafeAllocateBytes(_keysCount * PUBKEY_LENGTH);
        signatures = MemUtils.unsafeAllocateBytes(_keysCount * SIGNATURE_LENGTH);
        uint256 loadedKeysCount = 0;
        for (uint24 i = 0; i < activeNodeOperatorIds.length; ++i) {
            uint64 validatorsKeysToLoad = uint64(activeValidatorsKeysCountsAfter[i].sub(activeValidatorsKeysCountsBefore[i]));
            if (validatorsKeysToLoad == 0) continue;

            NodeOperator storage nodeOperator = _nodeOperators[activeNodeOperatorIds[i]];
            uint64 depositedValidatorsKeysCountBefore = nodeOperator.depositedValidatorsKeysCount;
            uint64 depositedValidatorsKeysCountAfter = depositedValidatorsKeysCountBefore.add(validatorsKeysToLoad);

            for (uint256 keyIndex = depositedValidatorsKeysCountBefore; keyIndex < depositedValidatorsKeysCountAfter; ++keyIndex) {
                (bytes memory pubkey, bytes memory signature) = _loadSigningKey(activeNodeOperatorIds[i], keyIndex);
                MemUtils.copyBytes(pubkey, publicKeys, loadedKeysCount * PUBKEY_LENGTH);
                MemUtils.copyBytes(signature, signatures, loadedKeysCount * SIGNATURE_LENGTH);
                ++loadedKeysCount;
            }
            nodeOperator.depositedValidatorsKeysCount = depositedValidatorsKeysCountAfter;
        }
        assert(loadedKeysCount == _keysCount);
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

    function _addValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) internal onlyExistedNodeOperator(_nodeOperatorId) authP(MANAGE_SIGNING_KEYS, arr(uint256(_nodeOperatorId))) {
        require(_keysCount != 0, "NO_KEYS");
        require(_publicKeys.length == _keysCount.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _keysCount.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        _increaseValidatorsKeysNonce();

        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];
        uint64 totalValidatorsKeysCount = nodeOperator.totalValidatorsKeysCount;
        for (uint256 i = 0; i < _keysCount; ++i) {
            bytes memory key = BytesLib.slice(_publicKeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            bytes memory sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeSigningKey(_nodeOperatorId, totalValidatorsKeysCount, key, sig);
            totalValidatorsKeysCount += 1;
            emit ReadyToDepositKeyAdded(_nodeOperatorId, key);
            // TODO: deprecated events
        }

        emit TotalValidatorsKeysCountChanged(_nodeOperatorId, totalValidatorsKeysCount);

        _nodeOperators[_nodeOperatorId].totalValidatorsKeysCount = totalValidatorsKeysCount;

        ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();
        totalValidatorsKeysStats.increaseTotalValidatorsKeysCount(_keysCount);
        _setTotalValidatorsKeysStats(totalValidatorsKeysStats);
    }

    function _removeUnusedValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) internal onlyExistedNodeOperator(_nodeOperatorId) {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        uint64 approveValidatorsCountBefore = nodeOperator.approvedValidatorsKeysCount;

        // removing from the last index to the highest one, so we won't get outside the array
        for (uint64 i = _fromIndex.add(_keysCount); i > _fromIndex; --i) {
            _removeUnusedKey(_nodeOperatorId, i - 1);
        }

        _increaseValidatorsKeysNonce();

        uint64 totalValidatorsCountAfter = nodeOperator.totalValidatorsKeysCount;
        uint64 approvedValidatorsCountAfter = nodeOperator.approvedValidatorsKeysCount;

        emit TotalValidatorsKeysCountChanged(_nodeOperatorId, totalValidatorsCountAfter);
        emit ApprovedValidatorsKeysCountChanged(_nodeOperatorId, approvedValidatorsCountAfter);

        ValidatorsKeysStats.State memory totalValidatorsKeysStats = _getTotalValidatorsKeysStats();
        totalValidatorsKeysStats.decreaseTotalValidatorsKeysCount(_keysCount);

        if (approveValidatorsCountBefore > approvedValidatorsCountAfter) {
            totalValidatorsKeysStats.decreaseApprovedValidatorsKeysCount(approveValidatorsCountBefore - approvedValidatorsCountAfter);
        }

        _setTotalValidatorsKeysStats(totalValidatorsKeysStats);
    }

    function _removeUnusedKey(uint24 _nodeOperatorId, uint64 _index) internal {
        NodeOperator storage nodeOperator = _nodeOperators[_nodeOperatorId];

        uint64 totalValidatorsKeysCount = nodeOperator.totalValidatorsKeysCount;
        uint64 lastValidatorKeyIndex = totalValidatorsKeysCount.sub(1);
        uint64 approvedValidatorsKeysCount = nodeOperator.approvedValidatorsKeysCount;
        uint64 depositedValidatorsKeysCount = nodeOperator.depositedValidatorsKeysCount;

        require(_index <= lastValidatorKeyIndex, "KEY_NOT_FOUND");
        require(_index >= depositedValidatorsKeysCount, "KEY_WAS_USED");

        (bytes memory removedKey, ) = _loadSigningKey(_nodeOperatorId, _index);

        if (_index < lastValidatorKeyIndex) {
            (bytes memory key, bytes memory signature) = _loadSigningKey(_nodeOperatorId, lastValidatorKeyIndex);
            _storeSigningKey(_nodeOperatorId, _index, key, signature);
        }

        _deleteSigningKey(_nodeOperatorId, lastValidatorKeyIndex);

        nodeOperator.totalValidatorsKeysCount = totalValidatorsKeysCount.sub(1);
        emit TotalValidatorsKeysCountChanged(_nodeOperatorId, _index);

        if (_index < approvedValidatorsKeysCount) {
            // decreasing the staking limit so the key at _index can't be used anymore
            nodeOperator.approvedValidatorsKeysCount = _index;
            emit ApprovedValidatorsKeysCountChanged(_nodeOperatorId, _index);
        }

        emit UnusedKeyRemoved(_nodeOperatorId, removedKey);
        /// @dev DEPRECATED
        emit SigningKeyRemoved(_nodeOperatorId, removedKey);
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
        uint256 keysOpIndex = getValidatorsKeysNonce();
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex + 1);
        emit KeysOpIndexSet(keysOpIndex + 1);
    }

    function _setTotalValidatorsKeysStats(ValidatorsKeysStats.State memory _validatorsKeysStats) internal {
        _validatorsKeysStats.store(TOTAL_VALIDATORS_KEYS_STATS);
    }

    function _getTotalValidatorsKeysStats() internal view returns (ValidatorsKeysStats.State memory) {
        return ValidatorsKeysStats.load(TOTAL_VALIDATORS_KEYS_STATS);
    }

    //
    // MODIFIERS
    //

    modifier onlyNonZeroAddress(address _a) {
        require(_a != address(0), "ZERO_ADDRESS");
        _;
    }

    modifier onlyExistedNodeOperator(uint24 _nodeOperatorId) {
        require(_nodeOperatorId < getNodeOperatorsCount(), "NODE_OPERATOR_NOT_FOUND");
        _;
    }

    modifier onlyValidNodeOperatorName(string _name) {
        require(bytes(_name).length > 0 && bytes(_name).length <= MAX_NODE_OPERATOR_NAME_LENGTH, "NAME_TOO_LONG");
        _;
    }
}
