// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/// @title Lido's Staking Module interface
interface IStakingModule {
    struct ValidatorsReport {
        uint256 totalExited;
        uint256 totalDeposited;
        uint256 totalVetted;
        uint256 totalStuck;
        uint256 totalRefunded;
        uint256 targetLimit;
        uint256 excessCount;
    }

    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    function getValidatorsReport() external view returns (ValidatorsReport memory report);

    function getValidatorsReport(uint256 _nodeOperatorId)
        external
        view
        returns (ValidatorsReport memory report);

    /// @notice Returns a counter that MUST change it's value when any of the following happens:
    ///     1. a node operator's key(s) is added
    ///     2. a node operator's key(s) is removed
    ///     3. a node operator's ready to deposit keys count is changed
    ///     4. a node operator was activated/deactivated
    ///     5. a node operator's key(s) is used for the deposit
    function getValidatorsKeysNonce() external view returns (uint256);

    /// @notice Returns total number of node operators
    function getNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns if the node operator with given id is active
    /// @param _nodeOperatorId Id of the node operator
    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool);

    /// @notice Called by StakingRouter to signal that stETH rewards were minted for this module.
    /// @param _totalShares Amount of stETH shares that were minted to reward all node operators.
    function handleRewardsMinted(uint256 _totalShares) external;

    /// @notice Updates the number of the validators of the given node operator that were requested
    ///         to exit but failed to do so in the max allowed time
    /// @param _nodeOperatorId Id of the node operator
    /// @param _stuckValidatorKeysCount New number of stuck validators of the node operator
    function updateStuckValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _stuckValidatorKeysCount
    ) external;

    /// @notice Updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorKeysCount New number of EXITED validators of the node operator
    /// @return number of exited validators across all node operators
    function updateExitedValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorKeysCount
    ) external returns (uint256);

    /// @notice Unsafely updates the validators count stats for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsKeysCount New number of EXITED validators of the node operator
    /// @param _stuckValidatorsKeysCount New number of stuck validators of the node operator
    function unsafeUpdateValidatorsKeysCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsKeysCount,
        uint256 _stuckValidatorsKeysCount
    ) external;

    /// @notice Called by StakingRouter after oracle finishes updating exited keys counts for all operators.
    function finishUpdatingExitedValidatorsKeysCount() external;

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

    event ValidatorsKeysNonceChanged(uint256 validatorsKeysNonce);
    event UnusedValidatorsKeysTrimmed(uint256 indexed nodeOperatorId, uint256 trimmedKeysCount);
}
