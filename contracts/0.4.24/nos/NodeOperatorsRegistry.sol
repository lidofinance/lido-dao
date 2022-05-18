// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

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
  * NOTE: the code below assumes moderate amount of node operators, i.e. up to `MAX_NODE_OPERATORS_COUNT`.
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
    uint256 constant public MAX_NODE_OPERATORS_COUNT = 200;

    uint256 internal constant UINT64_MAX = uint256(uint64(-1));

    bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = keccak256("lido.NodeOperatorsRegistry.signingKeysMappingName");

    /// @dev Node Operator parameters and internal state
    struct NodeOperator {
        bool active;    // a flag indicating if the operator can participate in further staking and reward distribution
        address rewardAddress;  // Ethereum 1 address which receives steth rewards for this operator
        string name;    // human-readable name
        uint64 stakingLimit;    // the maximum number of validators to stake for this operator
        uint64 stoppedValidators;   // number of signing keys which stopped validation (e.g. were slashed)

        uint64 totalSigningKeys;    // total amount of signing keys of this operator
        uint64 usedSigningKeys;     // number of signing keys of this operator which were used in deposits to the Ethereum 2
    }

    /// @dev Memory cache entry used in the assignNextKeys function
    struct DepositLookupCacheEntry {
        // Makes no sense to pack types since reading memory is as fast as any op
        uint256 id;
        uint256 stakingLimit;
        uint256 stoppedValidators;
        uint256 totalSigningKeys;
        uint256 usedSigningKeys;
        uint256 initialUsedSigningKeys;
    }

    /// @dev Mapping of all node operators. Mapping is used to be able to extend the struct.
    mapping(uint256 => NodeOperator) internal operators;

    // @dev Total number of operators
    bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.totalOperatorsCount");

    // @dev Cached number of active operators
    bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.activeOperatorsCount");

    /// @dev link to the Lido contract
    bytes32 internal constant LIDO_POSITION = keccak256("lido.NodeOperatorsRegistry.lido");

    /// @dev link to the index of operations with keys
    bytes32 internal constant KEYS_OP_INDEX_POSITION = keccak256("lido.NodeOperatorsRegistry.keysOpIndex");


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
        KEYS_OP_INDEX_POSITION.setStorageUint256(0);
        LIDO_POSITION.setStorageAddress(_lido);
        initialized();
    }

    /**
      * @notice Add node operator named `_name` with reward address `_rewardAddress` and staking limit = 0
      * @param _name Human-readable name
      * @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
      * @return a unique key of the added operator
      */
    function addNodeOperator(string _name, address _rewardAddress) external
        auth(ADD_NODE_OPERATOR_ROLE)
        validAddress(_rewardAddress)
        returns (uint256 id)
    {
        id = getNodeOperatorsCount();
        require(id < MAX_NODE_OPERATORS_COUNT, "MAX_NODE_OPERATORS_COUNT_EXCEEDED");

        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(id.add(1));

        NodeOperator storage operator = operators[id];

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.add(1));

        operator.active = true;
        operator.name = _name;
        operator.rewardAddress = _rewardAddress;
        operator.stakingLimit = 0;

        emit NodeOperatorAdded(id, _name, _rewardAddress, 0);

        return id;
    }

    /**
      * @notice `_active ? 'Enable' : 'Disable'` the node operator #`_id`
      */
    function setNodeOperatorActive(uint256 _id, bool _active) external
        authP(SET_NODE_OPERATOR_ACTIVE_ROLE, arr(_id, _active ? uint256(1) : uint256(0)))
        operatorExists(_id)
    {
        require(operators[_id].active != _active, "NODE_OPERATOR_ACTIVITY_ALREADY_SET");

        _increaseKeysOpIndex();

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        if (_active)
            ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.add(1));
        else
            ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount.sub(1));

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
        require(keccak256(operators[_id].name) != keccak256(_name), "NODE_OPERATOR_NAME_IS_THE_SAME");
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
        require(operators[_id].rewardAddress != _rewardAddress, "NODE_OPERATOR_ADDRESS_IS_THE_SAME");
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
        require(operators[_id].stakingLimit != _stakingLimit, "NODE_OPERATOR_STAKING_LIMIT_IS_THE_SAME");
        _increaseKeysOpIndex();
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
            uint64 totalSigningKeys = operators[operatorId].totalSigningKeys;
            uint64 usedSigningKeys = operators[operatorId].usedSigningKeys;
            if (totalSigningKeys != usedSigningKeys) { // write only if update is needed
                operators[operatorId].totalSigningKeys = usedSigningKeys;  // discard unused keys
                emit NodeOperatorTotalKeysTrimmed(operatorId, totalSigningKeys - usedSigningKeys);
            }
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
      * @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of DAO.
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      */
    function removeSigningKey(uint256 _operator_id, uint256 _index)
        external
        authP(MANAGE_SIGNING_KEYS, arr(_operator_id))
    {
        _removeSigningKey(_operator_id, _index);
    }

    /**
      * @notice Removes an #`_amount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      * @param _amount Number of keys to remove
      */
    function removeSigningKeys(uint256 _operator_id, uint256 _index, uint256 _amount)
        external
        authP(MANAGE_SIGNING_KEYS, arr(_operator_id))
    {
        // removing from the last index to the highest one, so we won't get outside the array
        for (uint256 i = _index.add(_amount); i > _index; --i) {
            _removeSigningKey(_operator_id, i - 1);
        }
    }

    /**
      * @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of Node Operator.
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      */
    function removeSigningKeyOperatorBH(uint256 _operator_id, uint256 _index) external {
        require(msg.sender == operators[_operator_id].rewardAddress, "APP_AUTH_FAILED");
        _removeSigningKey(_operator_id, _index);
    }

    /**
      * @notice Removes an #`_amount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      * @param _amount Number of keys to remove
      */
    function removeSigningKeysOperatorBH(uint256 _operator_id, uint256 _index, uint256 _amount) external {
        require(msg.sender == operators[_operator_id].rewardAddress, "APP_AUTH_FAILED");
        // removing from the last index to the highest one, so we won't get outside the array
        for (uint256 i = _index.add(_amount); i > _index; --i) {
            _removeSigningKey(_operator_id, i - 1);
        }
    }

    /**
     * @notice Selects and returns at most `_numKeys` signing keys (as well as the corresponding
     *         signatures) from the set of active keys and marks the selected keys as used.
     *         May only be called by the Lido contract.
     *
     * @param _numKeys The number of keys to select. The actual number of selected keys may be less
     *        due to the lack of active keys.
     */
    function assignNextSigningKeys(uint256 _numKeys) external onlyLido returns (bytes memory pubkeys, bytes memory signatures) {
        // Memory is very cheap, although you don't want to grow it too much
        DepositLookupCacheEntry[] memory cache = _loadOperatorCache();
        if (0 == cache.length)
            return (new bytes(0), new bytes(0));

        uint256 numAssignedKeys = 0;
        DepositLookupCacheEntry memory entry;

        while (numAssignedKeys < _numKeys) {
            // Finding the best suitable operator
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

            if (bestOperatorIdx == cache.length)  // not found
                break;

            entry = cache[bestOperatorIdx];
            assert(entry.usedSigningKeys < UINT64_MAX);

            ++entry.usedSigningKeys;
            ++numAssignedKeys;
        }

        if (numAssignedKeys == 0) {
            return (new bytes(0), new bytes(0));
        }

        if (numAssignedKeys > 1) {
            // we can allocate without zeroing out since we're going to rewrite the whole array
            pubkeys = MemUtils.unsafeAllocateBytes(numAssignedKeys * PUBKEY_LENGTH);
            signatures = MemUtils.unsafeAllocateBytes(numAssignedKeys * SIGNATURE_LENGTH);
        }

        uint256 numLoadedKeys = 0;

        for (uint256 i = 0; i < cache.length; ++i) {
            entry = cache[i];

            if (entry.usedSigningKeys == entry.initialUsedSigningKeys) {
                continue;
            }

            operators[entry.id].usedSigningKeys = uint64(entry.usedSigningKeys);

            for (uint256 keyIndex = entry.initialUsedSigningKeys; keyIndex < entry.usedSigningKeys; ++keyIndex) {
                (bytes memory pubkey, bytes memory signature) = _loadSigningKey(entry.id, keyIndex);
                if (numAssignedKeys == 1) {
                    _increaseKeysOpIndex();
                    return (pubkey, signature);
                } else {
                    MemUtils.copyBytes(pubkey, pubkeys, numLoadedKeys * PUBKEY_LENGTH);
                    MemUtils.copyBytes(signature, signatures, numLoadedKeys * SIGNATURE_LENGTH);
                    ++numLoadedKeys;
                }
            }

            if (numLoadedKeys == numAssignedKeys) {
                break;
            }
        }

        _increaseKeysOpIndex(); // numAssignedKeys is guaranteed to be > 0 here
        assert(numLoadedKeys == numAssignedKeys);
        return (pubkeys, signatures);
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

        uint256 activeValidatorsTotal = 0;
        for (uint256 operatorId = 0; operatorId < nodeOperatorCount; ++operatorId) {
            NodeOperator storage operator = operators[operatorId];
            if (!operator.active)
                continue;

            uint256 activeValidators = operator.usedSigningKeys.sub(operator.stoppedValidators);
            activeValidatorsTotal = activeValidatorsTotal.add(activeValidators);

            recipients[idx] = operator.rewardAddress;
            shares[idx] = activeValidators;

            ++idx;
        }

        if (activeValidatorsTotal == 0)
            return (recipients, shares);

        uint256 perValidatorReward = _totalRewardShares.div(activeValidatorsTotal);

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
      * @notice Returns n-th signing key of the node operator #`_operator_id`
      * @param _operator_id Node Operator id
      * @param _index Index of the key, starting with 0
      * @return key Key
      * @return depositSignature Signature needed for a deposit_contract.deposit call
      * @return used Flag indication if the key was used in the staking
      */
    function getSigningKey(uint256 _operator_id, uint256 _index) external view
        operatorExists(_operator_id)
        returns (bytes key, bytes depositSignature, bool used)
    {
        require(_index < operators[_operator_id].totalSigningKeys, "KEY_NOT_FOUND");

        (bytes memory key_, bytes memory signature) = _loadSigningKey(_operator_id, _index);

        return (key_, signature, _index < operators[_operator_id].usedSigningKeys);
    }

    /**
      * @notice Returns total number of node operators
      */
    function getNodeOperatorsCount() public view returns (uint256) {
        return TOTAL_OPERATORS_COUNT_POSITION.getStorageUint256();
    }

    /**
     * @notice Returns a monotonically increasing counter that gets incremented when any of the following happens:
     *   1. a node operator's key(s) is added;
     *   2. a node operator's key(s) is removed;
     *   3. a node operator's approved keys limit is changed.
     *   4. a node operator was activated/deactivated. Activation or deactivation of node operator
     *      might lead to usage of unvalidated keys in the assignNextSigningKeys method.
     */
    function getKeysOpIndex() public view returns (uint256) {
        return KEYS_OP_INDEX_POSITION.getStorageUint256();
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

    function to64(uint256 v) internal pure returns (uint64) {
        assert(v <= UINT64_MAX);
        return uint64(v);
    }

    function _signingKeyOffset(uint256 _operator_id, uint256 _keyIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SIGNING_KEYS_MAPPING_NAME, _operator_id, _keyIndex)));
    }

    function _storeSigningKey(uint256 _operator_id, uint256 _keyIndex, bytes memory _key, bytes memory _signature) internal {
        assert(_key.length == PUBKEY_LENGTH);
        assert(_signature.length == SIGNATURE_LENGTH);

        // key
        uint256 offset = _signingKeyOffset(_operator_id, _keyIndex);
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

    function _addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes _pubkeys, bytes _signatures) internal
        operatorExists(_operator_id)
    {
        require(_quantity != 0, "NO_KEYS");
        require(_pubkeys.length == _quantity.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _quantity.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        _increaseKeysOpIndex();

        for (uint256 i = 0; i < _quantity; ++i) {
            bytes memory key = BytesLib.slice(_pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            bytes memory sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeSigningKey(_operator_id, operators[_operator_id].totalSigningKeys + i, key, sig);
            emit SigningKeyAdded(_operator_id, key);
        }

        operators[_operator_id].totalSigningKeys = operators[_operator_id].totalSigningKeys.add(to64(_quantity));
    }

    function _removeSigningKey(uint256 _operator_id, uint256 _index) internal
        operatorExists(_operator_id)
    {
        require(_index < operators[_operator_id].totalSigningKeys, "KEY_NOT_FOUND");
        require(_index >= operators[_operator_id].usedSigningKeys, "KEY_WAS_USED");

        _increaseKeysOpIndex();

        (bytes memory removedKey, ) = _loadSigningKey(_operator_id, _index);

        uint256 lastIndex = operators[_operator_id].totalSigningKeys.sub(1);
        if (_index < lastIndex) {
            (bytes memory key, bytes memory signature) = _loadSigningKey(_operator_id, lastIndex);
            _storeSigningKey(_operator_id, _index, key, signature);
        }

        _deleteSigningKey(_operator_id, lastIndex);
        operators[_operator_id].totalSigningKeys = operators[_operator_id].totalSigningKeys.sub(1);

        if (_index < operators[_operator_id].stakingLimit) {
            // decreasing the staking limit so the key at _index can't be used anymore
            operators[_operator_id].stakingLimit = uint64(_index);
        }

        emit SigningKeyRemoved(_operator_id, removedKey);
    }

    function _deleteSigningKey(uint256 _operator_id, uint256 _keyIndex) internal {
        uint256 offset = _signingKeyOffset(_operator_id, _keyIndex);
        for (uint256 i = 0; i < (PUBKEY_LENGTH + SIGNATURE_LENGTH) / 32 + 1; ++i) {
            assembly {
                sstore(add(offset, i), 0)
            }
        }
    }

    function _loadSigningKey(uint256 _operator_id, uint256 _keyIndex) internal view returns (bytes memory key, bytes memory signature) {
        uint256 offset = _signingKeyOffset(_operator_id, _keyIndex);

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
        }
        require(idx == cache.length, "INCOSISTENT_ACTIVE_COUNT");

        return cache;
    }

    function _increaseKeysOpIndex() internal {
        uint256 keysOpIndex = getKeysOpIndex();
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex + 1);
        emit KeysOpIndexSet(keysOpIndex + 1);
    }
}
