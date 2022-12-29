// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.4.24;

import {NodeOperatorsRegistry} from "./NodeOperatorsRegistry.sol";
import {INodeOperatorsRegistryDeprecated} from "../interfaces/INodeOperatorsRegistryDeprecated.sol";

contract NodeOperatorsRegistryDeprecated is INodeOperatorsRegistryDeprecated, NodeOperatorsRegistry {
    /**
     * @notice `_active ? 'Enable' : 'Disable'` the node operator #`_id`
     */
    function setNodeOperatorActive(uint256 _id, bool _active)
        external
        authP(SET_NODE_OPERATOR_ACTIVE_ROLE, arr(_id, _active ? uint256(1) : uint256(0)))
        onlyExistedNodeOperator(uint24(_id))
    {
        if (_active) {
            _activateNodeOperator(uint24(_id));
        } else {
            _deactivateNodeOperator(uint24(_id));
        }

        emit NodeOperatorActiveSet(_id, _active);
    }

    function setNodeOperatorName(uint256 _id, string _name) external {
        setNodeOperatorName(uint24(_id), _name);
    }

    function setNodeOperatorRewardAddress(uint256 _id, address _rewardAddress) external {
        setNodeOperatorRewardAddress(uint24(_id), _rewardAddress);
    }

    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external {
        setNodeOperatorApprovedValidatorsKeysCount(uint24(_id), _stakingLimit);
        emit NodeOperatorStakingLimitSet(_id, _stakingLimit);
    }

    function reportStoppedValidators(uint256 _id, uint64 _stoppedIncrement) external {
        uint64 exitedValidatorsCountBefore = _nodeOperators[_id].exitedValidatorsKeysCount;
        updateNodeOperatorExitedValidatorsCount(uint24(_id), exitedValidatorsCountBefore.add(_stoppedIncrement));
        emit NodeOperatorTotalStoppedValidatorsReported(_id, _nodeOperators[_id].exitedValidatorsKeysCount);
    }

    function getNodeOperator(uint256 _nodeOperatorId, bool _fullInfo) {
        return getNodeOperator(uint24(_nodeOperatorId), _fullInfo);
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
    function addSigningKeys(
        uint256 _operator_id,
        uint256 _quantity,
        bytes _pubkeys,
        bytes _signatures
    ) external {
        addValidatorsKeys(uint24(_operator_id), uint64(_quantity), _pubkeys, _signatures);
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
    ) external {
        addValidatorsKeysByNodeOperator(uint24(_operator_id), uint64(_quantity), _pubkeys, _signatures);
    }

    /**
     * @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of DAO.
     * @param _operator_id Node Operator id
     * @param _index Index of the key, starting with 0
     */
    function removeSigningKey(uint256 _operator_id, uint256 _index) external {
        removeUnusedValidatorsKeys(uint24(_operator_id), uint64(_index), 1);
    }

    /**
     * @notice Removes an #`_amount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of DAO.
     * @param _operator_id Node Operator id
     * @param _index Index of the key, starting with 0
     * @param _amount Number of keys to remove
     */
    function removeSigningKeys(
        uint256 _operator_id,
        uint256 _index,
        uint256 _amount
    ) external {
        removeUnusedValidatorsKeys(uint24(_operator_id), uint64(_index), uint64(_amount));
    }

    /**
     * @notice Removes a validator signing key #`_index` of operator #`_id` from the set of usable keys. Executed on behalf of Node Operator.
     * @param _operator_id Node Operator id
     * @param _index Index of the key, starting with 0
     */
    function removeSigningKeyOperatorBH(uint256 _operator_id, uint256 _index) external {
        removeUnusedValidatorsKeysByNodeOperator(uint24(_operator_id), uint64(_index), 1);
    }

    /**
     * @notice Removes an #`_amount` of validator signing keys starting from #`_index` of operator #`_id` usable keys. Executed on behalf of Node Operator.
     * @param _operator_id Node Operator id
     * @param _index Index of the key, starting with 0
     * @param _amount Number of keys to remove
     */
    function removeSigningKeysOperatorBH(
        uint256 _operator_id,
        uint256 _index,
        uint256 _amount
    ) external {
        removeUnusedValidatorsKeysByNodeOperator(uint24(_operator_id), uint64(_index), uint64(_amount));
    }

    /**
     * @notice Returns total number of signing keys of the node operator #`_operator_id`
     */
    function getTotalSigningKeyCount(uint256 _operator_id) external view onlyExistedNodeOperator(uint24(_operator_id)) returns (uint256) {
        return _nodeOperators[uint24(_operator_id)].totalValidatorsKeysCount;
    }

    /**
     * @notice Returns number of usable signing keys of the node operator #`_operator_id`
     */
    function getUnusedSigningKeyCount(uint256 _operator_id) external view onlyExistedNodeOperator(uint24(_operator_id)) returns (uint256) {
        return _nodeOperators[_operator_id].totalValidatorsKeysCount.sub(_nodeOperators[uint24(_operator_id)].depositedValidatorsKeysCount);
    }

    /**
     * @notice Returns n-th signing key of the node operator #`_operator_id`
     * @param _operator_id Node Operator id
     * @param _index Index of the key, starting with 0
     * @return key Key
     * @return depositSignature Signature needed for a deposit_contract.deposit call
     * @return used Flag indication if the key was used in the staking
     */
    function getSigningKey(uint256 _operator_id, uint256 _index)
        external
        view
        onlyExistedNodeOperator(uint24(_operator_id))
        returns (
            bytes key,
            bytes depositSignature,
            bool used
        )
    {
        require(_index < _nodeOperators[uint24(_operator_id)].totalValidatorsKeysCount, "KEY_NOT_FOUND");

        (bytes memory key_, bytes memory signature) = _loadSigningKey(_operator_id, _index);

        return (key_, signature, _index < _nodeOperators[uint24(_operator_id)].depositedValidatorsKeysCount);
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
}
