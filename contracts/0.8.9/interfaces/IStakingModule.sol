// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

interface IStakingModule {
    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    /// @notice Returns the stats of the validators keys of node operators in the staking module
    function getValidatorsStats()
        external
        view
        returns (
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        );

    /// @notice Returns a counter that MUST change it's value when any of the following happens:
    ///     1. a node operator's key(s) is added;
    ///     2. a node operator's key(s) is removed;
    ///     3. a node operator's approved keys limit is changed.
    ///     4. a node operator was activated/deactivated. Activation or deactivation of node operator
    ///         might lead to usage of unvalidated keys in the _assignNextSigningKeys method.
    function getValidatorsKeysNonce() external view returns (uint256);

    /// @notice Returns total number of node operators
    function getNodeOperatorsCount() external view returns (uint24);

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() external view returns (uint24);

    function getNodeOperatorIsActive(uint24 _nodeOperatorId) external view returns (bool);

    /// @notice Returns the stats of the keys of node operator with given id
    function getNodeOperatorValidatorsStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        );

    function updateNodeOperatorExitedValidatorsCount(uint24 _nodeOperatorId, uint64 _exitedValidatorsCount) external;

    function trimUnusedValidatorsKeys() external;

    function enqueueApprovedValidatorsKeys(uint64 _keysCount, bytes calldata _calldata)
        external
        returns (
            uint64 enqueuedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        );

    event NodeOperatorAdded(uint24 indexed nodeOperatorId);
    event ValidatorsKeysNonceChanged(uint256 validatorsKeysNonce);

    event NodeOperatorActivated(uint24 indexed nodeOperatorId);
    event NodeOperatorDeactivated(uint24 indexed nodeOperatorId);

    event ApprovedValidatorsCountChanged(uint24 indexed nodeOperatorId, uint64 approvedValidatorsCount);
    event DepositedValidatorsCountChanged(uint24 indexed nodeOperatorId, uint64 depositedValidatorsCount);
    event ExitedValidatorsCountChanged(uint24 indexed nodeOperatorId, uint64 exitedValidatorsCount);
    event TotalValidatorsCountChanged(uint24 indexed nodeOperatorId, uint64 totalValidatorsCount);

    event UnusedKeysTrimmed(uint24 indexed nodeOperatorId, uint64 trimmedKeysCount);

    event NodeOperatorUnusedKeysTrimmed(uint24 indexed nodeOperatorId, uint64 trimmedKeysCount);
}
