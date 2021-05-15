// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;
pragma experimental ABIEncoderV2;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../interfaces/INodeOperatorsRegistry.sol";
import "../lib/MemUtils.sol";


/**
  * @title Node Operator registry implementation
  *
  * See the comment of `INodeOperatorsRegistry`.
  *
  * NOTE: the code below assumes moderate amount of node operators, e.g. up to 50.
  */
contract NodeOperatorsRegistry is INodeOperatorsRegistry, IsContract, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 constant public ADD_NODE_OPERATOR_ROLE = keccak256("ADD_NODE_OPERATOR_ROLE");
    bytes32 constant public SET_NODE_OPERATOR_ACTIVE_ROLE = keccak256("SET_NODE_OPERATOR_ACTIVE_ROLE");
    bytes32 constant public SET_NODE_OPERATOR_NAME_ROLE = keccak256("SET_NODE_OPERATOR_NAME_ROLE");
    bytes32 constant public SET_NODE_OPERATOR_ADDRESS_ROLE = keccak256("SET_NODE_OPERATOR_ADDRESS_ROLE");
    bytes32 constant public SET_NODE_OPERATOR_LIMIT_ROLE = keccak256("SET_NODE_OPERATOR_LIMIT_ROLE");
    bytes32 constant public REPORT_STOPPED_VALIDATORS_ROLE = keccak256("REPORT_STOPPED_VALIDATORS_ROLE");

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public SIGNATURE_LENGTH = 96;
    uint256 constant public KEYS_LEAF_SIZE = 8;

    uint256 internal constant UINT64_MAX = uint256(uint64(-1));

    bytes32 internal constant MERKLE_LEAVES_MAPPING_NAME = keccak256("lido.NodeOperatorsRegistry.merkleLeavesMappingName");


    /// @dev Node Operator parameters and internal state
    struct NodeOperator {
        bool active;    // a flag indicating if the operator can participate in further staking and reward distribution
        address rewardAddress;  // Ethereum 1 address which receives steth rewards for this operator
        string name;    // human-readable name
        uint64 stakingLimit;    // the maximum number of validators to stake for this operator
        uint64 stoppedValidators;   // number of signing keys which stopped validation (e.g. were slashed)

        uint64 totalSigningKeys;    // total amount of signing keys of this operator
        uint64 usedSigningKeys;     // number of signing keys of this operator which were used in deposits to the Ethereum 2

        bytes32 keysMerkleRoot;     // root of merkle tree containing operator's unused keys
    }

    /// @dev Memory cache entry used in the verifyNextKeys function
    struct DepositLookupCacheEntry {
        // Makes no sense to pack types since reading memory is as fast as any op
        uint256 id;
        uint256 stakingLimit;
        uint256 stoppedValidators;
        uint256 totalSigningKeys;
        uint256 usedSigningKeys;
        uint256 initialUsedSigningKeys;
        bytes32 keysMerkleRoot;
    }

    /// @dev Format for key verification data used in the verifyNextKeys function
    struct KeysData{
        uint256 operatorId;
        bytes publicKeys;
        bytes signatures;
        bytes proofData;
    }

    /// @dev Mapping of all node operators. Mapping is used to be able to extend the struct.
    mapping(uint256 => NodeOperator) internal operators;

    // @dev Total number of operators
    bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.totalOperatorsCount");

    // @dev Cached number of active operators
    bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.activeOperatorsCount");

    /// @dev link to the Lido contract
    bytes32 internal constant LIDO_POSITION = keccak256("lido.NodeOperatorsRegistry.lido");


    modifier onlyLido() {
        require(msg.sender == LIDO_POSITION.getStorageAddress(), "APP_AUTH_FAILED");
        _;
    }

    modifier validAddress(address _a) {
        require(_a != address(0), "EMPTY_ADDRESS");
        _;
    }

    modifier operatorExists(uint256 _id) {
        require(_id < getNodeOperatorsCount(), "NODE_OPERATOR_NOT_FOUND");
        _;
    }

    function initialize(address _lido) public onlyInit {
        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(0);
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(0);
        LIDO_POSITION.setStorageAddress(_lido);
        initialized();
    }

    /**
      * @notice Add node operator named `_name` with reward address `_rewardAddress` and staking limit `_stakingLimit`
      * @param _name Human-readable name
      * @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
      * @param _stakingLimit the maximum number of validators to stake for this operator
      * @return a unique key of the added operator
      */
    function addNodeOperator(string _name, address _rewardAddress, uint64 _stakingLimit) external
        auth(ADD_NODE_OPERATOR_ROLE)
        validAddress(_rewardAddress)
        returns (uint256 id)
    {
        id = getNodeOperatorsCount();
        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(id.add(1));

        NodeOperator storage operator = operators[id];

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.add(1));

        operator.active = true;
        operator.name = _name;
        operator.rewardAddress = _rewardAddress;
        operator.stakingLimit = _stakingLimit;

        emit NodeOperatorAdded(id, _name, _rewardAddress, _stakingLimit);

        return id;
    }

    /**
      * @notice `_active ? 'Enable' : 'Disable'` the node operator #`_id`
      */
    function setNodeOperatorActive(uint256 _id, bool _active) external
        authP(SET_NODE_OPERATOR_ACTIVE_ROLE, arr(_id, _active ? uint256(1) : uint256(0)))
        operatorExists(_id)
    {
        if (operators[_id].active != _active) {
            uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
            if (_active)
                ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.add(1));
            else
                ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.sub(1));
        }

        operators[_id].active = _active;

        emit NodeOperatorActiveSet(_id, _active);
    }

    /**
      * @notice Change human-readable name of the node operator #`_id` to `_name`
      */
    function setNodeOperatorName(uint256 _id, string _name) external
        authP(SET_NODE_OPERATOR_NAME_ROLE, arr(_id))
        operatorExists(_id)
    {
        operators[_id].name = _name;
        emit NodeOperatorNameSet(_id, _name);
    }

    /**
      * @notice Change reward address of the node operator #`_id` to `_rewardAddress`
      */
    function setNodeOperatorRewardAddress(uint256 _id, address _rewardAddress) external
        authP(SET_NODE_OPERATOR_ADDRESS_ROLE, arr(_id, uint256(_rewardAddress)))
        operatorExists(_id)
        validAddress(_rewardAddress)
    {
        operators[_id].rewardAddress = _rewardAddress;
        emit NodeOperatorRewardAddressSet(_id, _rewardAddress);
    }

    /**
      * @notice Set the maximum number of validators to stake for the node operator #`_id` to `_stakingLimit`
      */
    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external
        authP(SET_NODE_OPERATOR_LIMIT_ROLE, arr(_id, uint256(_stakingLimit)))
        operatorExists(_id)
    {
        operators[_id].stakingLimit = _stakingLimit;
        emit NodeOperatorStakingLimitSet(_id, _stakingLimit);
    }

    /**
      * @notice Report `_stoppedIncrement` more stopped validators of the node operator #`_id`
      */
    function reportStoppedValidators(uint256 _id, uint64 _stoppedIncrement) external
        authP(REPORT_STOPPED_VALIDATORS_ROLE, arr(_id, uint256(_stoppedIncrement)))
        operatorExists(_id)
    {
        require(0 != _stoppedIncrement, "EMPTY_VALUE");
        operators[_id].stoppedValidators = operators[_id].stoppedValidators.add(_stoppedIncrement);
        require(operators[_id].stoppedValidators <= operators[_id].usedSigningKeys, "STOPPED_MORE_THAN_LAUNCHED");

        emit NodeOperatorTotalStoppedValidatorsReported(_id, operators[_id].stoppedValidators);
    }

    /**
      * @notice Remove unused signing keys
      * @dev Function is used by the Lido contract
      */
    function trimUnusedKeys() external onlyLido {
        uint256 length = getNodeOperatorsCount();
        for (uint256 operatorId = 0; operatorId < length; ++operatorId) {
            operators[operatorId].keysMerkleRoot = bytes32(0); // clear merkle root
            if (operators[operatorId].totalSigningKeys != operators[operatorId].usedSigningKeys)  // write only if update is needed
                operators[operatorId].totalSigningKeys = operators[operatorId].usedSigningKeys;  // discard unused keys
        }
    }

    /**
      * @notice Add `_quantity` validator signing keys of operator #`_id` to the set of usable keys. Concatenated keys are: `_pubkeys`. Can be done by the DAO in question by using the designated rewards address.
      * @dev Along with each key the DAO has to provide a signatures for the
      *      (pubkey, withdrawal_credentials, 32000000000) message.
      *      Given that information, the contract'll be able to call
      *      deposit_contract.deposit on-chain.
      * @param _operator_id Node Operator id
      * @param _quantity Number of signing keys provided
      * @param _pubkeys Several concatenated validator signing keys
      * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
      */
    function addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes _pubkeys, bytes _signatures) external
        authP(MANAGE_SIGNING_KEYS, arr(_operator_id))
    {
        _addSigningKeys(_operator_id, _quantity, _pubkeys, _signatures);
    }

    /**
      * @notice Add `_quantity` validator signing keys of operator #`_id` to the set of usable keys. Concatenated keys are: `_pubkeys`. Can be done by node operator in question by using the designated rewards address.
      * @dev Along with each key the DAO has to provide a signatures for the
      *      (pubkey, withdrawal_credentials, 32000000000) message.
      *      Given that information, the contract'll be able to call
      *      deposit_contract.deposit on-chain.
      * @param _operator_id Node Operator id
      * @param _quantity Number of signing keys provided
      * @param _pubkeys Several concatenated validator signing keys
      * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
      */
    function addSigningKeysOperatorBH(
        uint256 _operator_id,
        uint256 _quantity,
        bytes _pubkeys,
        bytes _signatures
    )
        external
    {
        require(msg.sender == operators[_operator_id].rewardAddress, "APP_AUTH_FAILED");
        _addSigningKeys(_operator_id, _quantity, _pubkeys, _signatures);
    }

    /**
      * @notice Clears an operator's merkle tree root, invalidating all unused keys. Executed on behalf of DAO.
      * @param _operator_id Node Operator id
      */
    function clearMerkleRoot(uint256 _operator_id)
        external
        authP(MANAGE_SIGNING_KEYS, arr(_operator_id))
    {
        operators[_operator_id].keysMerkleRoot = bytes32(0);
        operators[_operator_id].totalSigningKeys = operators[_operator_id].usedSigningKeys;  // discard unused keys
    }

    /**
      * @notice Clears an operator's merkle tree root, invalidating all unused keys. Executed on behalf of Node Operator.
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      */
    function clearMerkleRootOperatorBH(uint256 _operator_id, uint256 _index) external {
        require(msg.sender == operators[_operator_id].rewardAddress, "APP_AUTH_FAILED");
        operators[_operator_id].keysMerkleRoot = bytes32(0);
        operators[_operator_id].totalSigningKeys = operators[_operator_id].usedSigningKeys;  // discard unused keys
    }

    /**
     * @notice Verifies a number of provided signing keys (as well as the corresponding signatures)
     *         against the set of active keys and marks the selected keys as used.
     *         May only be called by the Lido contract.
     *
     * @param _keysData array of KeysData structs containing signing keys+sigs along with merkle proofs
     *
     * @return Two byte arrays of the validated keys and signatures.
     */
    function verifyNextSigningKeys(KeysData[] _keysData) external onlyLido returns (bytes memory pubkeys, bytes memory signatures) {
        // Memory is very cheap, although you don't want to grow it too much
        DepositLookupCacheEntry[] memory cache = _loadOperatorCache();
        if (0 == cache.length)
            return (new bytes(0), new bytes(0));

        // TODO: rename these to correspond to multiple keys
        uint256 numKeys = _keysData.length;
        uint256 numAssignedKeys = 0;
        DepositLookupCacheEntry memory entry;

        // We can allocate without zeroing out since we're going to rewrite the whole array
        pubkeys = MemUtils.unsafeAllocateBytes(numKeys * PUBKEY_LENGTH);
        signatures = MemUtils.unsafeAllocateBytes(numKeys * SIGNATURE_LENGTH);

        while (numAssignedKeys < numKeys) {
            // Find the node operator with the fewest active validators and spare capacity
            uint256 bestOperatorIdx = cache.length;   // 'not found' flag
            uint256 smallestStake;
            // The loop is lightweight comparing to an ether transfer and .deposit invocation
            for (uint256 idx = 0; idx < cache.length; ++idx) {
                entry = cache[idx];

                assert(entry.usedSigningKeys <= entry.totalSigningKeys);
                if (entry.usedSigningKeys == entry.totalSigningKeys)
                    continue;

                uint256 stake = entry.usedSigningKeys.sub(entry.stoppedValidators);
                if (stake + 1 > entry.stakingLimit)
                    continue;

                if (bestOperatorIdx == cache.length || stake < smallestStake) {
                    bestOperatorIdx = idx;
                    smallestStake = stake;
                }
            }

            assert(bestOperatorIdx < cache.length);

            // Verify that the provided signing keys correspond to the keys provided by this node operator

            KeysData memory keyData = _keysData[numAssignedKeys];
            require(keyData.operatorId == bestOperatorIdx, "Must choose operator with smallest stake");

            entry = cache[bestOperatorIdx];
            assert(entry.usedSigningKeys < UINT64_MAX);

            require(entry.keysMerkleRoot != bytes32(0), "Merkle root must be initialised");

            bytes32 leafHash = keccak256("TODO: HASH KEYS AND SIGS");
            require(!_leafHashUsed(bestOperatorIdx, leafHash), "Signing keys already used");

            // TODO: Verify proof

            _markLeafUsed(bestOperatorIdx, leafHash);

            // Copy verified keys and signatures into array to be passed back to Lido

            MemUtils.copyBytes(keyData.publicKeys, pubkeys, numAssignedKeys * PUBKEY_LENGTH * KEYS_LEAF_SIZE);
            MemUtils.copyBytes(keyData.signatures, signatures, numAssignedKeys * SIGNATURE_LENGTH * KEYS_LEAF_SIZE);

            entry.usedSigningKeys += KEYS_LEAF_SIZE;
            ++numAssignedKeys;
        }

        // Update the number of used keys for each operator
        for (uint256 i = 0; i < cache.length; ++i) {
            entry = cache[i];

            if (entry.usedSigningKeys != entry.initialUsedSigningKeys) {
                operators[entry.id].usedSigningKeys = uint64(entry.usedSigningKeys);
            }
        }

        assert(numAssignedKeys == numKeys); // Make sure that every key has been validated
        return (pubkeys, signatures);
    }

    function _merkleLeafOffset(uint256 _operator_id,  bytes32 _leafHash) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(MERKLE_LEAVES_MAPPING_NAME, _operator_id, _leafHash)));
    }

    /**
     * @notice Returns whether a given leaf hash has been used in a merkle proof already
     * @dev Used to prevent the same signing keys being used multiple times
     */
    function _leafHashUsed(uint256 _operator_id, bytes32 _leafHash) internal returns (bool leafUsed) {
        uint256 offset = _merkleLeafOffset(_operator_id, _leafHash);
        assembly {
           mstore(leafUsed, sload(offset))
        }
    }

    /**
     * @notice Marks provided leaf hash as used
     * @dev Used to prevent the same signing keys being used multiple times
     */
    function _markLeafUsed(uint256 _operator_id, bytes32 _leafHash) internal {
        uint256 offset = _merkleLeafOffset(_operator_id, _leafHash);
        assembly {
            sstore(offset, 1)
        }
    }

    /**
      * @notice Returns the rewards distribution proportional to the effective stake for each node operator.
      * @param _totalRewardShares Total amount of reward shares to distribute.
      */
    function getRewardsDistribution(uint256 _totalRewardShares) external view
        returns (
            address[] memory recipients,
            uint256[] memory shares
        )
    {
        uint256 nodeOperatorCount = getNodeOperatorsCount();

        uint256 activeCount = getActiveNodeOperatorsCount();
        recipients = new address[](activeCount);
        shares = new uint256[](activeCount);
        uint256 idx = 0;

        uint256 effectiveStakeTotal = 0;
        for (uint256 operatorId = 0; operatorId < nodeOperatorCount; ++operatorId) {
            NodeOperator storage operator = operators[operatorId];
            if (!operator.active)
                continue;

            uint256 effectiveStake = operator.usedSigningKeys.sub(operator.stoppedValidators);
            effectiveStakeTotal = effectiveStakeTotal.add(effectiveStake);

            recipients[idx] = operator.rewardAddress;
            shares[idx] = effectiveStake;

            ++idx;
        }

        if (effectiveStakeTotal == 0)
            return (recipients, shares);

        uint256 perValidatorReward = _totalRewardShares.div(effectiveStakeTotal);

        for (idx = 0; idx < activeCount; ++idx) {
            shares[idx] = shares[idx].mul(perValidatorReward);
        }

        return (recipients, shares);
    }

    /**
      * @notice Returns number of active node operators
      */
    function getActiveNodeOperatorsCount() public view returns (uint256) {
        return ACTIVE_OPERATORS_COUNT_POSITION.getStorageUint256();
    }

    /**
      * @notice Returns the n-th node operator
      * @param _id Node Operator id
      * @param _fullInfo If true, name will be returned as well
      */
    function getNodeOperator(uint256 _id, bool _fullInfo) external view
        operatorExists(_id)
        returns
        (
            bool active,
            string name,
            address rewardAddress,
            uint64 stakingLimit,
            uint64 stoppedValidators,
            uint64 totalSigningKeys,
            uint64 usedSigningKeys
        )
    {
        NodeOperator storage operator = operators[_id];

        active = operator.active;
        name = _fullInfo ? operator.name : "";    // reading name is 2+ SLOADs
        rewardAddress = operator.rewardAddress;
        stakingLimit = operator.stakingLimit;
        stoppedValidators = operator.stoppedValidators;
        totalSigningKeys = operator.totalSigningKeys;
        usedSigningKeys = operator.usedSigningKeys;
    }

    /**
      * @notice Returns total number of signing keys of the node operator #`_operator_id`
      */
    function getTotalSigningKeyCount(uint256 _operator_id) external view operatorExists(_operator_id) returns (uint256) {
        return operators[_operator_id].totalSigningKeys;
    }

    /**
      * @notice Returns number of usable signing keys of the node operator #`_operator_id`
      */
    function getUnusedSigningKeyCount(uint256 _operator_id) external view operatorExists(_operator_id) returns (uint256) {
        return operators[_operator_id].totalSigningKeys.sub(operators[_operator_id].usedSigningKeys);
    }

    /**
      * @notice Returns total number of node operators
      */
    function getNodeOperatorsCount() public view returns (uint256) {
        return TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
    }

    function _isEmptySigningKey(bytes memory _key) internal pure returns (bool) {
        assert(_key.length == PUBKEY_LENGTH);
        // algorithm applicability constraint
        assert(PUBKEY_LENGTH >= 32 && PUBKEY_LENGTH <= 64);

        uint256 k1;
        uint256 k2;
        assembly {
            k1 := mload(add(_key, 0x20))
            k2 := mload(add(_key, 0x40))
        }

        return 0 == k1 && 0 == (k2 >> ((2 * 32 - PUBKEY_LENGTH) * 8));
    }

    function to64(uint256 v) internal pure returns (uint64) {
        assert(v <= uint256(uint64(-1)));
        return uint64(v);
    }

    function _addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes _pubkeys, bytes _signatures) internal
        operatorExists(_operator_id)
    {
        require(_quantity != 0, "NO_KEYS");
        require(_pubkeys.length == _quantity.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _quantity.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        for (uint256 i = 0; i < _quantity; ++i) {
            bytes memory key = BytesLib.slice(_pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            bytes memory sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            emit SigningKeyAdded(_operator_id, key);
        }

        operators[_operator_id].totalSigningKeys = operators[_operator_id].totalSigningKeys.add(to64(_quantity));
    }

    function _loadOperatorCache() internal view returns (DepositLookupCacheEntry[] memory cache) {
        cache = new DepositLookupCacheEntry[](getActiveNodeOperatorsCount());
        if (0 == cache.length)
            return cache;

        uint256 totalOperators = getNodeOperatorsCount();
        uint256 idx = 0;
        for (uint256 operatorId = 0; operatorId < totalOperators; ++operatorId) {
            NodeOperator storage operator = operators[operatorId];

            if (!operator.active)
                continue;

            DepositLookupCacheEntry memory entry = cache[idx++];
            entry.id = operatorId;
            entry.stakingLimit = operator.stakingLimit;
            entry.stoppedValidators = operator.stoppedValidators;
            entry.totalSigningKeys = operator.totalSigningKeys;
            entry.usedSigningKeys = operator.usedSigningKeys;
            entry.initialUsedSigningKeys = entry.usedSigningKeys;
            entry.keysMerkleRoot = entry.keysMerkleRoot;
        }
        require(idx == cache.length, "INCOSISTENT_ACTIVE_COUNT");

        return cache;
    }
}
