pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../interfaces/IStakingProvidersRegistry.sol";


/**
  * @title Staking provider registry implementation
  *
  * See the comment of `IStakingProvidersRegistry`.
  *
  * NOTE: the code below assumes moderate amount of staking providers, e.g. up to 50.
  */
contract StakingProvidersRegistry is IStakingProvidersRegistry, IsContract, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public SET_POOL = keccak256("SET_POOL");
    bytes32 constant public MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 constant public ADD_STAKING_PROVIDER_ROLE = keccak256("ADD_STAKING_PROVIDER_ROLE");
    bytes32 constant public SET_STAKING_PROVIDER_ACTIVE_ROLE = keccak256("SET_STAKING_PROVIDER_ACTIVE_ROLE");
    bytes32 constant public SET_STAKING_PROVIDER_NAME_ROLE = keccak256("SET_STAKING_PROVIDER_NAME_ROLE");
    bytes32 constant public SET_STAKING_PROVIDER_ADDRESS_ROLE = keccak256("SET_STAKING_PROVIDER_ADDRESS_ROLE");
    bytes32 constant public SET_STAKING_PROVIDER_LIMIT_ROLE = keccak256("SET_STAKING_PROVIDER_LIMIT_ROLE");
    bytes32 constant public REPORT_STOPPED_VALIDATORS_ROLE = keccak256("REPORT_STOPPED_VALIDATORS_ROLE");

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public SIGNATURE_LENGTH = 96;

    bytes32 internal constant SIGNING_KEYS_MAPPING_NAME = keccak256("depools.DePool.signingKeys");


    /// @dev Staking provider parameters and internal state
    struct StakingProvider {
        bool active;    // a flag indicating if the SP can participate in further staking and reward distribution
        address rewardAddress;  // Ethereum 1 address which receives steth rewards for this SP
        string name;    // human-readable name
        uint64 stakingLimit;    // the maximum number of validators to stake for this SP
        uint64 stoppedValidators;   // number of signing keys which stopped validation (e.g. were slashed)

        uint64 totalSigningKeys;    // total amount of signing keys of this SP
        uint64 usedSigningKeys;     // number of signing keys of this SP which were used in deposits to the Ethereum 2
    }

    /// @dev Mapping of all staking providers. Mapping is used to be able to extend the struct.
    mapping(uint256 => StakingProvider) internal sps;

    // @dev Total number of SPs
    uint256 internal totalSPCount;

    // @dev Cached number of active SPs
    uint256 internal activeSPCount;

    /// @dev link to the pool
    address public pool;


    modifier onlyPool() {
        require(msg.sender == pool, "APP_AUTH_FAILED");
        _;
    }

    modifier validAddress(address _a) {
        require(_a != address(0), "EMPTY_ADDRESS");
        _;
    }

    modifier SPExists(uint256 _id) {
        require(_id < totalSPCount, "STAKING_PROVIDER_NOT_FOUND");
        _;
    }


    function initialize() public onlyInit {
        totalSPCount = 0;
        activeSPCount = 0;
        initialized();
    }


    /**
      * @notice Set the pool address to `_pool`
      */
    function setPool(address _pool) external auth(SET_POOL) {
        require(isContract(_pool), "POOL_NOT_CONTRACT");
        pool = _pool;
    }


    /**
      * @notice Add staking provider named `name` with reward address `rewardAddress` and staking limit `stakingLimit` validators
      * @param _name Human-readable name
      * @param _rewardAddress Ethereum 1 address which receives stETH rewards for this SP
      * @param _stakingLimit the maximum number of validators to stake for this SP
      * @return a unique key of the added SP
      */
    function addStakingProvider(string _name, address _rewardAddress, uint64 _stakingLimit) external
        auth(ADD_STAKING_PROVIDER_ROLE)
        validAddress(_rewardAddress)
        returns (uint256 id)
    {
        id = totalSPCount++;
        StakingProvider storage sp = sps[id];

        activeSPCount++;
        sp.active = true;
        sp.name = _name;
        sp.rewardAddress = _rewardAddress;
        sp.stakingLimit = _stakingLimit;

        emit StakingProviderAdded(id, _name, _rewardAddress, _stakingLimit);
    }

    /**
      * @notice `_active ? 'Enable' : 'Disable'` the staking provider #`_id`
      */
    function setStakingProviderActive(uint256 _id, bool _active) external
        authP(SET_STAKING_PROVIDER_ACTIVE_ROLE, arr(_id, _active ? uint256(1) : uint256(0)))
        SPExists(_id)
    {
        if (sps[_id].active != _active) {
            if (_active)
                activeSPCount++;
            else
                activeSPCount = activeSPCount.sub(1);
        }

        sps[_id].active = _active;

        emit StakingProviderActiveSet(_id, _active);
    }

    /**
      * @notice Change human-readable name of the staking provider #`_id` to `_name`
      */
    function setStakingProviderName(uint256 _id, string _name) external
        authP(SET_STAKING_PROVIDER_NAME_ROLE, arr(_id))
        SPExists(_id)
    {
        sps[_id].name = _name;
        emit StakingProviderNameSet(_id, _name);
    }

    /**
      * @notice Change reward address of the staking provider #`_id` to `_rewardAddress`
      */
    function setStakingProviderRewardAddress(uint256 _id, address _rewardAddress) external
        authP(SET_STAKING_PROVIDER_ADDRESS_ROLE, arr(_id, uint256(_rewardAddress)))
        SPExists(_id)
        validAddress(_rewardAddress)
    {
        sps[_id].rewardAddress = _rewardAddress;
        emit StakingProviderRewardAddressSet(_id, _rewardAddress);
    }

    /**
      * @notice Set the maximum number of validators to stake for the staking provider #`_id` to `_stakingLimit`
      */
    function setStakingProviderStakingLimit(uint256 _id, uint64 _stakingLimit) external
        authP(SET_STAKING_PROVIDER_LIMIT_ROLE, arr(_id, uint256(_stakingLimit)))
        SPExists(_id)
    {
        sps[_id].stakingLimit = _stakingLimit;
        emit StakingProviderStakingLimitSet(_id, _stakingLimit);
    }

    /**
      * @notice Report `_stoppedIncrement` more stopped validators of the staking provider #`_id`
      */
    function reportStoppedValidators(uint256 _id, uint64 _stoppedIncrement) external
        authP(REPORT_STOPPED_VALIDATORS_ROLE, arr(_id, uint256(_stoppedIncrement)))
        SPExists(_id)
    {
        require(0 != _stoppedIncrement, "EMPTY_VALUE");
        sps[_id].stoppedValidators = sps[_id].stoppedValidators.add(_stoppedIncrement);
        require(sps[_id].stoppedValidators <= sps[_id].usedSigningKeys, "STOPPED_MORE_THAN_LAUNCHED");

        emit StakingProviderTotalStoppedValidatorsReported(_id, sps[_id].stoppedValidators);
    }

    /**
      * @notice Update used key counts
      * @dev Function is used by the pool
      * @param _ids Array of staking provider ids
      * @param _usedSigningKeys Array of corresponding used key counts (the same length as _ids)
      */
    function updateUsedKeys(uint256[] _ids, uint64[] _usedSigningKeys) external onlyPool {
        require(_ids.length == _usedSigningKeys.length, "BAD_LENGTH");
        for (uint256 i = 0; i < _ids.length; ++i) {
            require(_ids[i] < totalSPCount, "STAKING_PROVIDER_NOT_FOUND");
            StakingProvider storage sp = sps[_ids[i]];

            uint64 current = sp.usedSigningKeys;
            uint64 new_ = _usedSigningKeys[i];

            require(current <= new_, "USED_KEYS_DECREASED");
            if (current == new_)
                continue;

            require(new_ <= sp.totalSigningKeys, "INCONSISTENCY");

            sp.usedSigningKeys = new_;
        }
    }

    /**
      * @notice Remove unused signing keys
      * @dev Function is used by the pool
      */
    function trimUnusedKeys() external onlyPool {
        uint256 length = totalSPCount;
        for (uint256 SP_id = 0; SP_id < length; ++SP_id) {
            if (sps[SP_id].totalSigningKeys != sps[SP_id].usedSigningKeys)    // write only if update is needed
                // discard unused keys
                sps[SP_id].totalSigningKeys = sps[SP_id].usedSigningKeys;
        }
    }


    /**
      * @notice Add `_quantity` validator signing keys to the set of usable keys. Concatenated keys are: `_pubkeys`. Can be done by the DAO or by staking provider in question by using the designated rewards address.
      * @dev Along with each key the DAO has to provide a signatures for the
      *      (pubkey, withdrawal_credentials, 32000000000) message.
      *      Given that information, the contract'll be able to call
      *      validator_registration.deposit on-chain.
      * @param _SP_id Staking provider id
      * @param _quantity Number of signing keys provided
      * @param _pubkeys Several concatenated validator signing keys
      * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
      */
    function addSigningKeys(uint256 _SP_id, uint256 _quantity, bytes _pubkeys, bytes _signatures) external
        SPExists(_SP_id)
    {
        require(msg.sender == sps[_SP_id].rewardAddress
                || canPerform(msg.sender, MANAGE_SIGNING_KEYS, arr(_SP_id)), "APP_AUTH_FAILED");

        require(_quantity != 0, "NO_KEYS");
        require(_pubkeys.length == _quantity.mul(PUBKEY_LENGTH), "INVALID_LENGTH");
        require(_signatures.length == _quantity.mul(SIGNATURE_LENGTH), "INVALID_LENGTH");

        for (uint256 i = 0; i < _quantity; ++i) {
            bytes memory key = BytesLib.slice(_pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptySigningKey(key), "EMPTY_KEY");
            bytes memory sig = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeSigningKey(_SP_id, sps[_SP_id].totalSigningKeys + i, key, sig);
            emit SigningKeyAdded(_SP_id, key);
        }

        sps[_SP_id].totalSigningKeys = sps[_SP_id].totalSigningKeys.add(to64(_quantity));
    }

    /**
      * @notice Removes a validator signing key #`_index` from the set of usable keys
      * @param _SP_id Staking provider id
      * @param _index Index of the key, starting with 0
      */
    function removeSigningKey(uint256 _SP_id, uint256 _index) external
        SPExists(_SP_id)
    {
        require(msg.sender == sps[_SP_id].rewardAddress
                || canPerform(msg.sender, MANAGE_SIGNING_KEYS, arr(_SP_id)), "APP_AUTH_FAILED");

        require(_index < sps[_SP_id].totalSigningKeys, "KEY_NOT_FOUND");
        require(_index >= sps[_SP_id].usedSigningKeys, "KEY_WAS_USED");

        (bytes memory removedKey, ) = _loadSigningKey(_SP_id, _index);

        uint256 lastIndex = sps[_SP_id].totalSigningKeys.sub(1);
        if (_index < lastIndex) {
            (bytes memory key, bytes memory signature) = _loadSigningKey(_SP_id, lastIndex);
            _storeSigningKey(_SP_id, _index, key, signature);
        }

        _deleteSigningKey(_SP_id, lastIndex);
        sps[_SP_id].totalSigningKeys = sps[_SP_id].totalSigningKeys.sub(1);

        emit SigningKeyRemoved(_SP_id, removedKey);
    }


    /**
      * @notice Distributes rewards among staking providers.
      * @dev Function is used by the pool
      * @param _token Reward token (must be ERC20-compatible)
      * @param _totalReward Total amount to distribute (must be transferred to this contract beforehand)
      */
    function distributeRewards(address _token, uint256 _totalReward) external onlyPool {
        uint256 length = totalSPCount;
        uint64 effectiveStakeTotal;
        for (uint256 SP_id = 0; SP_id < length; ++SP_id) {
            StakingProvider storage sp = sps[SP_id];
            if (!sp.active)
                continue;

            uint64 effectiveStake = sp.usedSigningKeys.sub(sp.stoppedValidators);
            effectiveStakeTotal = effectiveStakeTotal.add(effectiveStake);
        }

        if (0 == effectiveStakeTotal)
            revert("NO_STAKE");

        for (SP_id = 0; SP_id < length; ++SP_id) {
            sp = sps[SP_id];
            if (!sp.active)
                continue;

            effectiveStake = sp.usedSigningKeys.sub(sp.stoppedValidators);
            uint256 reward = uint256(effectiveStake).mul(_totalReward).div(uint256(effectiveStakeTotal));
            require(IERC20(_token).transfer(sp.rewardAddress, reward), "TRANSFER_FAILED");
            // leaves some dust on the balance of this
        }
    }


    /**
      * @notice Returns total number of staking providers
      */
    function getStakingProvidersCount() external view returns (uint256) {
        return totalSPCount;
    }
    /**
      * @notice Returns number of active staking providers
      */
    function getActiveStakingProvidersCount() external view returns (uint256) {
        return activeSPCount;
    }

    /**
      * @notice Returns the n-th staking provider
      * @param _id Staking provider id
      * @param _fullInfo If true, name will be returned as well
      */
    function getStakingProvider(uint256 _id, bool _fullInfo) external view
        SPExists(_id)
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
        StakingProvider storage sp = sps[_id];

        active = sp.active;
        name = _fullInfo ? sp.name : "";    // reading name is 2+ SLOADs
        rewardAddress = sp.rewardAddress;
        stakingLimit = sp.stakingLimit;
        stoppedValidators = sp.stoppedValidators;
        totalSigningKeys = sp.totalSigningKeys;
        usedSigningKeys = sp.usedSigningKeys;
    }

    /**
      * @notice Returns total number of signing keys of the staking provider #`_SP_id`
      */
    function getTotalSigningKeyCount(uint256 _SP_id) external view SPExists(_SP_id) returns (uint256) {
        return sps[_SP_id].totalSigningKeys;
    }

    /**
      * @notice Returns number of usable signing keys of the staking provider #`_SP_id`
      */
    function getUnusedSigningKeyCount(uint256 _SP_id) external view SPExists(_SP_id) returns (uint256) {
        return sps[_SP_id].totalSigningKeys.sub(sps[_SP_id].usedSigningKeys);
    }

    /**
      * @notice Returns n-th signing key of the staking provider #`_SP_id`
      * @param _SP_id Staking provider id
      * @param _index Index of the key, starting with 0
      * @return key Key
      * @return depositSignature Signature needed for a validator_registration.deposit call
      * @return used Flag indication if the key was used in the staking
      */
    function getSigningKey(uint256 _SP_id, uint256 _index) external view
        SPExists(_SP_id)
        returns (bytes key, bytes depositSignature, bool used)
    {
        require(_index < sps[_SP_id].totalSigningKeys, "KEY_NOT_FOUND");

        (bytes memory key_, bytes memory signature) = _loadSigningKey(_SP_id, _index);

        return (key_, signature, _index < sps[_SP_id].usedSigningKeys);
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

    function _signingKeyOffset(uint256 _SP_id, uint256 _keyIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SIGNING_KEYS_MAPPING_NAME, _SP_id, _keyIndex)));
    }

    function _storeSigningKey(uint256 _SP_id, uint256 _keyIndex, bytes memory _key, bytes memory _signature) internal {
        assert(_key.length == PUBKEY_LENGTH);
        assert(_signature.length == SIGNATURE_LENGTH);
        // algorithm applicability constraints
        assert(PUBKEY_LENGTH >= 32 && PUBKEY_LENGTH <= 64);
        assert(0 == SIGNATURE_LENGTH % 32);

        // key
        uint256 offset = _signingKeyOffset(_SP_id, _keyIndex);
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

    function _deleteSigningKey(uint256 _SP_id, uint256 _keyIndex) internal {
        uint256 offset = _signingKeyOffset(_SP_id, _keyIndex);
        for (uint256 i = 0; i < (PUBKEY_LENGTH + SIGNATURE_LENGTH) / 32 + 1; ++i) {
            assembly {
                sstore(add(offset, i), 0)
            }
        }
    }

    function _loadSigningKey(uint256 _SP_id, uint256 _keyIndex) internal view returns (bytes memory key, bytes memory signature) {
        // algorithm applicability constraints
        assert(PUBKEY_LENGTH >= 32 && PUBKEY_LENGTH <= 64);
        assert(0 == SIGNATURE_LENGTH % 32);

        uint256 offset = _signingKeyOffset(_SP_id, _keyIndex);

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
    }
}
