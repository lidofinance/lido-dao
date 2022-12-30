// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/// @title Lido's Staking Module interface
interface IStakingModule {
    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    /// @notice Returns the validators stats of all node operators in the staking module
    /// @return exitedValidatorsCount Total number of validators in the EXITED state
    /// @return activeValidatorsKeysCount Total number of validators in active state
    /// @return readyToDepositValidatorsKeysCount Total number of validators ready to be deposited
    function getValidatorsKeysStats()
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        );

    /// @notice Returns the validators stats of all node operators in the staking module
    /// @param _nodeOperatorId Node operator id to get data for
    /// @return exitedValidatorsCount Total number of validators in the EXITED state
    /// @return activeValidatorsKeysCount Total number of validators in active state
    /// @return readyToDepositValidatorsKeysCount Total number of validators ready to be deposited
    function getValidatorsKeysStats(uint256 _nodeOperatorId)
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        );

    /// @notice Returns a counter that MUST change it's value when any of the following happens:
    ///     1. a node operator's key(s) is added
    ///     2. a node operator's key(s) is removed
    ///     3. a node operator's ready to deposit keys count is changed
    ///     4. a node operator was activated/deactivated
    function getValidatorsKeysNonce() external view returns (uint256);

    /// @notice Returns total number of node operators
    function getNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns if the node operator with given id is active
    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool);

    /// @notice Updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    function updateExitedValidatorsKeysCount(uint256 _nodeOperatorId, uint256 _exitedValidatorsKeysCount) external;

    /// @notice Invalidates all unused validators keys for all node operators
    function invalidateReadyToDepositKeys() external;

    /// @notice Requests the given number of the validator keys from the staking module
    /// @param _keysCount Requested keys count to return
    /// @param _calldata Staking module defined data encoded as bytes
    /// @return returnedKeysCount Actually returned keys count
    /// @return publicKeys Batch of the concatenated public validators keys
    /// @return signatures Batch of the concatenated signatures for returned public keys
    function requestValidatorsKeysForDeposits(uint256 _keysCount, bytes calldata _calldata)
        external
        returns (
            uint256 returnedKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        );

    event NodeOperatorAdded(uint256 indexed nodeOperatorId);
    event ValidatorsKeysNonceChanged(uint256 validatorsKeysNonce);

    event NodeOperatorActivated(uint256 indexed nodeOperatorId);
    event NodeOperatorDeactivated(uint256 indexed nodeOperatorId);

    event UnusedValidatorsKeysTrimmed(uint256 indexed nodeOperatorId, uint256 trimmedKeysCount);

    event NodeOperatorUnusedValidatorsKeysTrimmed(uint256 indexed nodeOperatorId, uint256 trimmedKeysCount);
}
