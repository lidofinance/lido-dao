// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

interface IStakingModule {
    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    /// @notice Returns the stats of the validators keys of node operators in the staking module
    function getValidatorsKeysStats()
        external
        view
        returns (
            uint64 exitedValidatorsKeysCount,
            uint64 depositedValidatorsKeysCount,
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
    function getNodeOperatorValidatorsKeysStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 exitedValidatorsKeysCount,
            uint64 depositedValidatorsKeysCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        );

    function updateNodeOperatorExitedValidatorsKeysCount(uint24 _nodeOperatorId, uint64 _exitedValidatorsKeysCount) external;

    function trimUnusedValidatorsKeys() external;

    function enqueueApprovedValidatorsKeys(uint64 _keysCount, bytes _calldata)
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

    event ApprovedValidatorsKeysCountChanged(uint24 indexed nodeOperatorId, uint64 approvedValidatorsCount);
    event DepositedValidatorsKeysCountChanged(uint24 indexed nodeOperatorId, uint64 depositedValidatorsCount);
    event ExitedValidatorsKeysCountChanged(uint24 indexed nodeOperatorId, uint64 exitedValidatorsCount);
    event TotalValidatorsKeysCountChanged(uint24 indexed nodeOperatorId, uint64 totalValidatorsCount);

    event UnusedValidatorsKeysTrimmed(uint24 indexed nodeOperatorId, uint64 trimmedKeysCount);

    event NodeOperatorUnusedValidatorsKeysTrimmed(uint24 indexed nodeOperatorId, uint64 trimmedKeysCount);
}
