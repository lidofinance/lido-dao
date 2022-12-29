// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

interface InodeOperatorsRegistryDeprecated {}

/**
 * @title Node Operator registry
 *
 * Node Operator registry manages signing keys and other node operator data.
 * It's also responsible for distributing rewards to node operators.
 */
interface INodeOperatorsRegistry {
    /**
     * @notice Add node operator named `name` with reward address `rewardAddress` and staking limit = 0 validators
     * @param _name Human-readable name
     * @param _rewardAddress Ethereum 1 address which receives stETH rewards for this operator
     * @return id a unique id of the added operator
     */
    function addNodeOperator(string _name, address _rewardAddress) external returns (uint24 id);

    function activateNodeOperator(uint24 _nodeOperatorId) external;

    function deactivateNodeOperator(uint24 _nodeOperatorId) external;

    /**
     * @notice Change human-readable name of the node operator #`_nodeOperatorId` to `_name`
     */
    function setNodeOperatorName(uint24 _nodeOperatorId, string _name) external;

    /**
     * @notice Change reward address of the node operator #`_nodeOperatorId` to `_rewardAddress`
     */
    function setNodeOperatorRewardAddress(uint24 _nodeOperatorId, address _rewardAddress) external;

    /**
     * @notice Set the maximum number of validators to stake for the node operator #`_nodeOperatorId` to `_newEverDepositedKeysLimit`
     */
    function setNodeOperatorApprovedValidatorsKeysCount(uint24 _nodeOperatorId, uint64 _approvedValidatorsKeysCount) external;

    /**
     * @notice Returns the n-th node operator
     * @param _nodeOperatorId Node Operator id
     * @param _fullInfo If true, name will be returned as well
     */
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

    /**
     * @notice Returns the rewards distribution proportional to the effective stake for each node operator.
     * @param _totalRewardShares Total amount of reward shares to distribute.
     */
    function getRewardsDistribution(uint256 _totalRewardShares)
        external
        view
        returns (address[] memory recipients, uint256[] memory shares);

    /**
     * @notice Add `_quantity` validator signing keys to the keys of the node operator #`_operator_id`. Concatenated keys are: `_pubkeys`
     * @dev Along with each key the DAO has to provide a signatures for the
     *      (publicKey, withdrawal_credentials, 32000000000) message.
     *      Given that information, the contract'll be able to call
     *      deposit_contract.deposit on-chain.
     * @param _nodeOperatorId Node Operator id
     * @param _keysCount Number of signing keys provided
     * @param _publicKeys Several concatenated validator signing keys
     * @param _signatures Several concatenated signatures for (publicKey, withdrawal_credentials, 32000000000) messages
     */
    function addValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) external;

    /**
     * @notice Add `_quantity` validator signing keys of operator #`_id` to the set of usable keys. Concatenated keys are: `_pubkeys`. Can be done by node operator in question by using the designated rewards address.
     * @dev Along with each key the DAO has to provide a signatures for the
     *      (pubkey, withdrawal_credentials, 32000000000) message.
     *      Given that information, the contract'll be able to call
     *      deposit_contract.deposit on-chain.
     * @param _nodeOperatorId Node Operator id
     * @param _keysCount Number of signing keys provided
     * @param _publicKeys Several concatenated validator signing keys
     * @param _signatures Several concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages
     */
    function addValidatorsKeysByNodeOperator(
        uint24 _nodeOperatorId,
        uint64 _keysCount,
        bytes _publicKeys,
        bytes _signatures
    ) external;

    /**
     * @notice Removes an #`_keysCount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
     * @param _nodeOperatorId Node Operator id
     * @param _fromIndex Index of the key, starting with 0
     * @param _keysCount Number of keys to remove
     */
    function removeUnusedValidatorsKeys(
        uint24 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) external;

    /**
     * @notice Removes an #`_amount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
     * @param _nodeOperatorId Node Operator id
     * @param _fromIndex Index of the key, starting with 0
     * @param _keysCount Number of keys to remove
     */
    function removeUnusedValidatorsKeysByNodeOperator(
        uint24 _nodeOperatorId,
        uint64 _fromIndex,
        uint64 _keysCount
    ) external;

    /**
     * @notice Returns n-th signing key of the node operator #`_operator_id`
     * @param _nodeOperatorId Node Operator id
     * @param _index Index of the key, starting with 0
     * @return key Key
     * @return depositSignature Signature needed for a deposit_contract.deposit call
     * @return used Flag indication if the key was used in the staking
     */
    function getValidatorKey(uint256 _nodeOperatorId, uint256 _index)
        external
        view
        returns (
            bytes key,
            bytes depositSignature,
            bool used
        );

    function getNodeOperatorValidatorKey(uint256 _nodeOperatorId, uint256 _index)
        external
        view
        returns (
            bytes key,
            bytes depositSignature,
            bool used
        );

    function getNodeOperatorValidatorsKeys(
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

    function distributeRewards() external returns (uint256 distributed);

    event ReadyToDepositKeyAdded(uint256 indexed operatorId, bytes pubkey);
    event UnusedKeyRemoved(uint256 indexed operatorId, bytes pubkey);
    event KeysOpIndexSet(uint256 keysOpIndex);
    event ContractVersionSet(uint256 version);
    event StethContractSet(address stethAddress);
    event StakingModuleTypeSet(bytes32 moduleType);
    event ActiveKeysCountChanged(uint256 newActiveKeysCount);
    event AvailableKeysCountChanged(uint256 newAvailableKeysCount);
    event NodeOperatorDeactivated(uint24 indexed nodeOperatorId);
    event NodeOperatorAdded(uint256 id, string name, address rewardAddress, uint64 stakingLimit);
    event NodeOperatorActiveSet(uint256 indexed id, bool active);
    event NodeOperatorNameSet(uint256 indexed id, string name);
    event NodeOperatorRewardAddressSet(uint256 indexed id, address rewardAddress);
    event NodeOperatorEverDepositedKeysLimitSet(uint24 indexed id, uint64 newEverDepositedKeysLimit);
    event NodeOperatorTotalStoppedValidatorsReported(uint256 indexed id, uint64 totalStopped);
    event NodeOperatorTotalKeysTrimmed(uint256 indexed id, uint64 totalKeysTrimmed);
    event RewardsDistributedInShares(uint256 indexed id, uint256 amount);
}
