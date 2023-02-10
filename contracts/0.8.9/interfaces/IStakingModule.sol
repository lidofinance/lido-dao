// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

struct ValidatorsReport {
    uint256 totalExited;
    uint256 totalDeposited;
    uint256 totalVetted;
    uint256 totalStuck;
    uint256 totalRefunded;
    uint256 targetLimit;
    uint256 excessCount;
}

/// @title Lido's Staking Module interface
interface IStakingModule {
    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    function getValidatorsReport() external view returns (ValidatorsReport memory report);

    function getValidatorsReport(uint256 _nodeOperatorId)
        external
        view
        returns (ValidatorsReport memory report);

    /// @notice Returns a counter that MUST change its value whenever the deposit data set changes.
    ///     Below is the typical list of actions that requires an update of the nonce:
    ///     1. a node operator's deposit data is added
    ///     2. a node operator's deposit data is removed
    ///     3. a node operator's ready-to-deposit data size is changed
    ///     4. a node operator was activated/deactivated
    ///     5. a node operator's deposit data is used for the deposit
    ///     Note: Depending on the StakingModule implementation above list might be extended
    function getNonce() external view returns (uint256);

    /// @notice Returns total number of node operators
    function getNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns number of active node operators
    function getActiveNodeOperatorsCount() external view returns (uint256);

    /// @notice Returns if the node operator with given id is active
    /// @param _nodeOperatorId Id of the node operator
    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool);

    /// @notice Returns up to `_limit` node operator ids starting from the `_offset`. The order of
    ///     the returned ids is not defined and might change between calls.
    /// @dev This view must not revert in case of invalid data passed. When `_offset` exceeds the
    ///     total node operators count or when `_limit` is equal to 0 MUST be returned empty array.
    function getNodeOperatorIds(uint256 _offset, uint256 _limit)
        external
        view
        returns (uint256[] memory nodeOperatorIds);


    /// @notice Called by StakingRouter to signal that stETH rewards were minted for this module.
    /// @param _totalShares Amount of stETH shares that were minted to reward all node operators.
    function handleRewardsMinted(uint256 _totalShares) external;

    /// @notice Updates the number of the validators of the given node operator that were requested
    ///         to exit but failed to do so in the max allowed time
    /// @param _nodeOperatorId Id of the node operator
    /// @param _stuckValidatorsCount New number of stuck validators of the node operator
    function updateStuckValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _stuckValidatorsCount
    ) external;

    /// @notice Updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsCount New number of EXITED validators of the node operator
    /// @return number of exited validators across all node operators
    function updateExitedValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsCount
    ) external returns (uint256);

    /// @notice Unsafely updates the validators count stats for node operator with given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsCount New number of EXITED validators of the node operator
    /// @param _stuckValidatorsCount New number of stuck validators of the node operator
    function unsafeUpdateValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsCount,
        uint256 _stuckValidatorsCount
    ) external;

    /// @notice Called by StakingRouter after oracle finishes updating exited validators counts for all operators.
    function finishUpdatingExitedValidatorsCount() external;

    /// @notice Invalidates all unused validators for all node operators
    function invalidateDepositData() external;

    /// @notice Obtains up to _depositsCount deposit data to be used by StakingRouter
    ///     to deposit to the Ethereum Deposit contract
    /// @param _depositsCount Desireable number of deposits to be done
    /// @param _calldata Staking module defined data encoded as bytes
    /// @return depositsCount Actual deposits count might be done with returned data
    /// @return publicKeys Batch of the concatenated public validators keys
    /// @return signatures Batch of the concatenated deposit signatures for returned public keys
    function obtainDepositData(uint256 _depositsCount, bytes calldata _calldata) external returns (
        uint256 depositsCount,
        bytes memory publicKeys,
        bytes memory signatures
    );

    event NonceChanged(uint256 nonce);
}
