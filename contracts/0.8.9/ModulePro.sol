// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "./IModule.sol";
import "./lib/MemUtils.sol";
import "./lib/BytesLib.sol";
import "./lib/UnstructuredStorage.sol";

import "hardhat/console.sol";

contract ModulePro is IModule {
    using UnstructuredStorage for bytes32;

    address public immutable  lido;
    uint16 public immutable  fee;
    uint16 public immutable  treasuryFee;

    uint256 public totalKeys;
    uint256 public totalUsedKeys;
    uint256 public totalStoppedKeys;
    uint256 public totalWithdrawnKeys;
    
    ModuleType public moduleType;

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public SIGNATURE_LENGTH = 96;
    uint256 constant public MAX_NODE_OPERATORS_COUNT = 200;

    uint256 internal constant UINT64_MAX = type(uint64).max;

    // @dev Total number of operators
    bytes32 internal constant TOTAL_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.totalOperatorsCount");

    // @dev Cached number of active operators
    bytes32 internal constant ACTIVE_OPERATORS_COUNT_POSITION = keccak256("lido.NodeOperatorsRegistry.activeOperatorsCount");

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

    constructor(ModuleType _type, address _lido, uint16 _fee, uint16 _treasuryFee) {
        require(ModuleType.DVT >= _type, "INVALID_TYPE");

        lido = _lido;

        //check cap or max amount of _fee + _treasuryFee
        fee = _fee;
        treasuryFee = _treasuryFee;
        moduleType = _type;
    } 

    function getFee() external view returns (uint16) {
        return fee+treasuryFee;
    }

    function getTotalKeys() external view returns (uint256) {
        return totalKeys;
    }    

    function getTotalUsedKeys() external view returns (uint256) {
        return totalUsedKeys;
    }

    function getTotalStoppedKeys() external view returns(uint256) {
        return totalStoppedKeys;
    }

    function getTotalWithdrawnKeys() external view returns(uint256) {
        return totalWithdrawnKeys;
    }

    function getRewardsDistribution(uint256 _totalRewardShares) external view
        returns (
            address[] memory recipients,
            uint256[] memory shares
        )
    {
        
    }

    /// @notice Add node operator named `_name` with reward address `_rewardAddress` and staking limit = 0
    /// @param _name Human-readable name
    /// @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
    /// @return id a unique key of the added operator
    function addNodeOperator(string memory _name, address _rewardAddress) external
        validAddress(_rewardAddress)
        returns (uint256 id)
    {
        id = getNodeOperatorsCount();
        require(id < MAX_NODE_OPERATORS_COUNT, "MAX_NODE_OPERATORS_COUNT_EXCEEDED");


        TOTAL_OPERATORS_COUNT_POSITION.setStorageUint256(id+1);

        NodeOperator storage operator = operators[id];

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(++activeOperatorsCount);

        operator.active = true;
        operator.name = _name;
        operator.rewardAddress = _rewardAddress;
        operator.stakingLimit = 0;

        emit NodeOperatorAdded(id, _name, _rewardAddress, 0);

        return id;
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
    function addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) external
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
        bytes memory _pubkeys,
        bytes memory _signatures
    )
        external
    {
        require(msg.sender == operators[_operator_id].rewardAddress, "APP_AUTH_FAILED");
        _addSigningKeys(_operator_id, _quantity, _pubkeys, _signatures);
    }

    function _addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) internal
        operatorExists(_operator_id)
    {
        require(_quantity != 0, "NO_KEYS");
        require(_pubkeys.length == _quantity * PUBKEY_LENGTH, "INVALID_LENGTH");
        require(_signatures.length == _quantity * SIGNATURE_LENGTH, "INVALID_LENGTH");

        _increaseKeysOpIndex();

        for (uint256 i = 0; i < _quantity; ++i) {
            bytes memory key = BytesLib.slice(_pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            bytes memory sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeSigningKey(_operator_id, operators[_operator_id].totalSigningKeys + i, key, sig);
            emit SigningKeyAdded(_operator_id, key);
        }

        operators[_operator_id].totalSigningKeys = operators[_operator_id].totalSigningKeys + to64(_quantity);
        totalKeys += _quantity;
    }

    /**
      * @notice Set the maximum number of validators to stake for the node operator #`_id` to `_stakingLimit`
      */
    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external
        operatorExists(_id)
    {
        require(operators[_id].stakingLimit != _stakingLimit, "NODE_OPERATOR_STAKING_LIMIT_IS_THE_SAME");
        _increaseKeysOpIndex();
        operators[_id].stakingLimit = _stakingLimit;
        emit NodeOperatorStakingLimitSet(_id, _stakingLimit);
    }

    /**
      * @notice `_active ? 'Enable' : 'Disable'` the node operator #`_id`
      */
    function setNodeOperatorActive(uint256 _id, bool _active) external
        operatorExists(_id)
    {
        require(operators[_id].active != _active, "NODE_OPERATOR_ACTIVITY_ALREADY_SET");

        _increaseKeysOpIndex();

        uint256 activeOperatorsCount = getActiveNodeOperatorsCount();
        if (_active)
            ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount + 1);
        else
            ACTIVE_OPERATORS_COUNT_POSITION.setStorageUint256(activeOperatorsCount - 1);

        operators[_id].active = _active;

        emit NodeOperatorActiveSet(_id, _active);
    }

    function assignNextSigningKeys(uint256 _numKeys) external returns (bytes memory pubkeys, bytes memory signatures) {
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

                uint256 stake = entry.usedSigningKeys - entry.stoppedValidators;
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
                    totalUsedKeys++;
                    emit KeysAssigned(pubkey, signature);
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
        totalUsedKeys += numAssignedKeys;
        emit KeysAssigned(pubkeys, signatures);
        return (pubkeys, signatures);
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

    function _signingKeyOffset(uint256 _operator_id, uint256 _keyIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SIGNING_KEYS_MAPPING_NAME, _operator_id, _keyIndex)));
    }

    function _increaseKeysOpIndex() internal {
        uint256 keysOpIndex = getKeysOpIndex();
        KEYS_OP_INDEX_POSITION.setStorageUint256(keysOpIndex + 1);
        emit KeysOpIndexSet(keysOpIndex + 1);
    }

    function _loadOperatorCache() internal view returns (DepositLookupCacheEntry[] memory cache) {
        cache = new DepositLookupCacheEntry[](getActiveNodeOperatorsCount());
        if (0 == cache.length)
            return cache;

        uint256 totalOperators = getNodeOperatorsCount();
        uint256 idx = 0;
        for (uint256 operatorId = 0; operatorId < totalOperators; ++operatorId) {
            NodeOperator storage operator = operators[operatorId];

            if (!operator.active) {
                continue;
            }

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

    /**
      * @notice Returns number of active node operators
      */
    function getActiveNodeOperatorsCount() public view returns (uint256) {
        return ACTIVE_OPERATORS_COUNT_POSITION.getStorageUint256();
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

    //only for testing purposal
    function setTotalKeys(uint256 _keys) external { totalKeys = _keys; }
    function setTotalUsedKeys(uint256 _keys) external { totalUsedKeys = _keys; }
    function setTotalStoppedKeys(uint256 _keys) external { totalStoppedKeys = _keys; }
    function setTotalWithdrawnKeys(uint256 _keys) external { totalWithdrawnKeys = _keys; }
}