// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/// @title Node Operator registry
/// @notice Node Operator registry manages signing keys and other node operator data.
///     It's also responsible for distributing rewards to node operators.
interface INodeOperatorsRegistry {
    /// @notice Add node operator named `name` with reward address `rewardAddress` and staking limit = 0 validators
    /// @param _name Human-readable name
    /// @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
    /// @return nodeOperatorId a unique key of the added operator
    function addNodeOperator(string _name, address _rewardAddress) external returns (uint256 nodeOperatorId);

    /// @notice Activates deactivated node operator with given id
    /// @param _nodeOperatorId Node operator id to deactivate
    function activateNodeOperator(uint256 _nodeOperatorId) external;

    /// @notice Deactivates active node operator with given id
    /// @param _nodeOperatorId Node operator id to deactivate
    function deactivateNodeOperator(uint256 _nodeOperatorId) external;

    /// @notice Change human-readable name of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set name for
    /// @param _name New human-readable name of the node operator
    function setNodeOperatorName(uint256 _nodeOperatorId, string _name) external;

    /// @notice Change reward address of the node operator with given id
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _rewardAddress Execution layer Ethereum address to set as reward address
    function setNodeOperatorRewardAddress(uint256 _nodeOperatorId, address _rewardAddress) external;

    /// @notice Set the maximum number of validators to stake for the node operator with given id
    /// @param _nodeOperatorId Node operator id to set reward address for
    /// @param _vettedSigningKeysCount New staking limit of the node operator
    function setNodeOperatorStakingLimit(uint256 _nodeOperatorId, uint64 _vettedSigningKeysCount) external;

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() external view returns (uint256);

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
        );

    /// @notice Returns the rewards distribution proportional to the effective stake for each node operator.
    /// @param _totalRewardShares Total amount of reward shares to distribute.
    function getRewardsDistribution(uint256 _totalRewardShares)
        external
        view
        returns (address[] memory recipients, uint256[] memory shares);

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
    ) external;

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
    ) external;

    /// @notice Removes a validator signing key #`_index` from the keys of the node operator #`_nodeOperatorId`
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    function removeSigningKey(uint256 _nodeOperatorId, uint256 _index) external;

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    function removeSigningKeys(
        uint256 _nodeOperatorId,
        uint256 _fromIndex,
        uint256 _keysCount
    ) external;

    /// @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _index Index of the key, starting with 0
    function removeSigningKeyOperatorBH(uint256 _nodeOperatorId, uint256 _index) external;

    /// @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
    /// @param _nodeOperatorId Node Operator id
    /// @param _fromIndex Index of the key, starting with 0
    /// @param _keysCount Number of keys to remove
    function removeSigningKeysOperatorBH(
        uint256 _nodeOperatorId,
        uint256 _fromIndex,
        uint256 _keysCount
    ) external;

    /// @notice Returns total number of signing keys of the node operator #`_nodeOperatorId`
    function getTotalSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256);

    /// @notice Returns number of usable signing keys of the node operator #`_nodeOperatorId`
    function getUnusedSigningKeyCount(uint256 _nodeOperatorId) external view returns (uint256);

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
        );

    /// @notice Returns a monotonically increasing counter that gets incremented when any of the following happens:
    ///   1. a node operator's key(s) is added;
    ///   2. a node operator's key(s) is removed;
    ///   3. a node operator's approved keys limit is changed.
    ///   4. a node operator was activated/deactivated. Activation or deactivation of node operator
    ///      might lead to usage of unvalidated keys in the assignNextSigningKeys method.
    function getKeysOpIndex() external view returns (uint256);

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
        );

    /// @notice Unsafely updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    function unsafeUpdateExitedValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsKeysCount) external;

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
}
