pragma solidity 0.4.24;


/**
  * @title Staking provider registry
  *
  * Staking provider registry manages signing keys and other staking provider data.
  * It's also responsible for distributing rewards to staking providers.
  */
interface IStakingProvidersRegistry {
    /**
      * @notice Add staking provider named `name` with reward address `rewardAddress` and staking limit `stakingLimit` validators
      * @param _name Human-readable name
      * @param _rewardAddress Ethereum 1 address which receives stETH rewards for this SP
      * @param _stakingLimit the maximum number of validators to stake for this SP
      * @return a unique key of the added SP
      */
    function addStakingProvider(string _name, address _rewardAddress, uint64 _stakingLimit) external returns (uint256 id);

    /**
      * @notice `_active ? 'Enable' : 'Disable'` the staking provider #`_id`
      */
    function setStakingProviderActive(uint256 _id, bool _active) external;

    /**
      * @notice Change human-readable name of the staking provider #`_id` to `_name`
      */
    function setStakingProviderName(uint256 _id, string _name) external;

    /**
      * @notice Change reward address of the staking provider #`_id` to `_rewardAddress`
      */
    function setStakingProviderRewardAddress(uint256 _id, address _rewardAddress) external;

    /**
      * @notice Set the maximum number of validators to stake for the staking provider #`_id` to `_stakingLimit`
      */
    function setStakingProviderStakingLimit(uint256 _id, uint64 _stakingLimit) external;

    /**
      * @notice Report `_stoppedIncrement` more stopped validators of the staking provider #`_id`
      */
    function reportStoppedValidators(uint256 _id, uint64 _stoppedIncrement) external;

    /**
      * @notice Update used key counts
      * @dev Function is used by the pool
      * @param _ids Array of staking provider ids
      * @param _usedSigningKeys Array of corresponding used key counts (the same length as _ids)
      */
    function updateUsedKeys(uint256[] _ids, uint64[] _usedSigningKeys) external;

    /**
      * @notice Remove unused signing keys
      * @dev Function is used by the pool
      */
    function trimUnusedKeys() external;

    /**
      * @notice Returns total number of staking providers
      */
    function getStakingProvidersCount() external view returns (uint256);

    /**
      * @notice Returns number of active staking providers
      */
    function getActiveStakingProvidersCount() external view returns (uint256);

    /**
      * @notice Returns the n-th staking provider
      * @param _id Staking provider id
      * @param _fullInfo If true, name will be returned as well
      */
    function getStakingProvider(uint256 _id, bool _fullInfo) external view returns (
        bool active,
        string name,
        address rewardAddress,
        uint64 stakingLimit,
        uint64 stoppedValidators,
        uint64 totalSigningKeys,
        uint64 usedSigningKeys);

    event StakingProviderAdded(uint256 id, string name, address rewardAddress, uint64 stakingLimit);
    event StakingProviderActiveSet(uint256 indexed id, bool active);
    event StakingProviderNameSet(uint256 indexed id, string name);
    event StakingProviderRewardAddressSet(uint256 indexed id, address rewardAddress);
    event StakingProviderStakingLimitSet(uint256 indexed id, uint64 stakingLimit);
    event StakingProviderTotalStoppedValidatorsReported(uint256 indexed id, uint64 totalStopped);


    /**
      * @notice Distributes rewards among staking providers.
      * @dev Function is used by the pool
      * @param _token Reward token (must be ERC20-compatible)
      * @param _totalReward Total amount to distribute (must be transferred to this contract beforehand)
      */
    function distributeRewards(address _token, uint256 _totalReward) external;


    /**
      * @notice Add `_quantity` validator signing keys to the keys of the staking provider #`_SP_id`. Concatenated keys are: `_pubkeys`
      * @dev Along with each key the DAO has to provide a signatures for the
      *      (pubkey, withdrawal_credentials, 32000000000) message.
      *      Given that information, the contract'll be able to call
      *      validator_registration.deposit on-chain.
      * @param _SP_id Staking provider id
      * @param _quantity Number of signing keys provided
      * @param _pubkeys Several concatenated validator signing keys
      * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
      */
    function addSigningKeys(uint256 _SP_id, uint256 _quantity, bytes _pubkeys, bytes _signatures) external;

    /**
      * @notice Removes a validator signing key #`_index` from the keys of the staking provider #`_SP_id`
      * @param _SP_id Staking provider id
      * @param _index Index of the key, starting with 0
      */
    function removeSigningKey(uint256 _SP_id, uint256 _index) external;

    /**
      * @notice Returns total number of signing keys of the staking provider #`_SP_id`
      */
    function getTotalSigningKeyCount(uint256 _SP_id) external view returns (uint256);

    /**
      * @notice Returns number of usable signing keys of the staking provider #`_SP_id`
      */
    function getUnusedSigningKeyCount(uint256 _SP_id) external view returns (uint256);

    /**
      * @notice Returns n-th signing key of the staking provider #`_SP_id`
      * @param _SP_id Staking provider id
      * @param _index Index of the key, starting with 0
      * @return key Key
      * @return depositSignature Signature needed for a validator_registration.deposit call
      * @return used Flag indication if the key was used in the staking
      */
    function getSigningKey(uint256 _SP_id, uint256 _index) external view returns
            (bytes key, bytes depositSignature, bool used);

    event SigningKeyAdded(uint256 indexed SP_id, bytes pubkey);
    event SigningKeyRemoved(uint256 indexed SP_id, bytes pubkey);
}
