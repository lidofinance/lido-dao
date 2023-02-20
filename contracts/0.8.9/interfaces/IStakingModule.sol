// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

/// @title Lido's Staking Module interface
interface IStakingModule {
    /// @notice Returns the type of the staking module
    function getType() external view returns (bytes32);

    /// @notice Returns all-validators summary in the staking module
    /// @return totalExitedValidators total number of validators in the EXITED state
    ///     on the Consensus Layer. This value can't decrease in normal conditions
    /// @return totalDepositedValidators total number of validators deposited via the
    ///     official Deposit Contract. This value is a cumulative counter: even when the validator
    ///     goes into EXITED state this counter is not decreasing
    /// @return depositableValidatorsCount number of validators in the set available for deposit
    function getStakingModuleSummary() external view returns (
        uint256 totalExitedValidators,
        uint256 totalDepositedValidators,
        uint256 depositableValidatorsCount
    );

    /// @notice Returns all-validators summary belonging to the node operator with the given id
    /// @param _nodeOperatorId id of the operator to return report for
    /// @return isTargetLimitActive shows whether the current target limit applied to the node operator
    /// @return targetValidatorsCount relative target active validators limit for operator
    /// @return stuckValidatorsCount number of validators with an expired request to exit time
    /// @return refundedValidatorsCount number of validators that can't be withdrawn, but deposit
    ///     costs were compensated to the Lido by the node operator
    /// @return stuckPenaltyEndTimestamp time when the penalty for stuck validators stops applying
    ///     to node operator rewards
    /// @return totalExitedValidators total number of validators in the EXITED state
    ///     on the Consensus Layer. This value can't decrease in normal conditions
    /// @return totalDepositedValidators total number of validators deposited via the official
    ///     Deposit Contract. This value is a cumulative counter: even when the validator goes into
    ///     EXITED state this counter is not decreasing
    /// @return depositableValidatorsCount number of validators in the set available for deposit
    function getNodeOperatorSummary(uint256 _nodeOperatorId) external view returns (
        bool isTargetLimitActive,
        uint256 targetValidatorsCount,
        uint256 stuckValidatorsCount,
        uint256 refundedValidatorsCount,
        uint256 stuckPenaltyEndTimestamp,
        uint256 totalExitedValidators,
        uint256 totalDepositedValidators,
        uint256 depositableValidatorsCount
    );

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
    /// @param _nodeOperatorIds bytes packed array of the node operators id
    /// @param _stuckValidatorsCounts bytes packed array of the new number of STUCK validators for the node operators
    function updateStuckValidatorsCount(
        bytes calldata _nodeOperatorIds,
        bytes calldata _stuckValidatorsCounts
    ) external;

    /// @notice Updates the number of the validators in the EXITED state for node operator with given id
    /// @param _nodeOperatorIds bytes packed array of the node operators id
        /// @param _stuckValidatorsCounts bytes packed array of the new number of EXITED validators for the node operators
    function updateExitedValidatorsCount(
        bytes calldata _nodeOperatorIds,
        bytes calldata _stuckValidatorsCounts
    ) external;

    /// @notice Updates the number of the refunded validators for node operator with the given id
    /// @param _nodeOperatorId Id of the node operator
    /// @param _refundedValidatorsCount New number of refunded validators of the node operator
    function updateRefundedValidatorsCount(uint256 _nodeOperatorId, uint256 _refundedValidatorsCount) external;

    /// @notice Unsafely updates the number of validators in the EXITED/STUCK states for node operator with given id
    ///      'unsafely' means that this method can both increase and decrease exited and stuck counters
    /// @param _nodeOperatorId Id of the node operator
    /// @param _exitedValidatorsCount New number of EXITED validators for the node operator
    /// @param _stuckValidatorsCount New number of STUCK validator for the node operator
    function unsafeUpdateValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _exitedValidatorsCount,
        uint256 _stuckValidatorsCount
    ) external;

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

    /// @notice Called by StakingRouter after oracle finishes updating validators counters for all node operators
    function onAllValidatorCountersUpdated() external;

    /// @notice Called by StakingRouter when withdrawal credentials are changed.
    /// @dev This method MUST discard all StakingModule's unused deposit data cause they become
    ///     invalid after the withdrawal credentials are changed
    function onWithdrawalCredentialsChanged() external;

    /// @dev Event to be emitted on StakingModule's nonce change
    event NonceChanged(uint256 nonce);
}
