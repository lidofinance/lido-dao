// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {WithdrawalQueueBase} from "contracts/0.8.9/WithdrawalQueueBase.sol";

contract WithdrawalsQueueBaseHarness is WithdrawalQueueBase {

  constructor() {
    _initializeQueue();
  }

  function exposedEnqueue(uint128 _amountOfStETH, uint128 _amountOfShares, address _owner) external returns (uint256 requestId) {
    return _enqueue(_amountOfStETH, _amountOfShares, _owner);
  }

  function exposedFinalize(uint256 _lastRequestIdToBeFinalized, uint256 _amountOfETH, uint256 _maxShareRate) external {
    _finalize(_lastRequestIdToBeFinalized, _amountOfETH, _maxShareRate);
  }

  function exposedGetStatus(uint256 _requestId) external view returns (WithdrawalRequestStatus memory status) {
    return _getStatus(_requestId);
  }

  function exposedFindCheckpointHint(uint256 _requestId, uint256 _start, uint256 _end) external view returns (uint256) {
    return _findCheckpointHint(_requestId, _start, _end);
  }

  function exposedSendValue(address _recipient, uint256 _amount) external {
    return _sendValue(_recipient, _amount);
  }

  function exposedCalcBatch(WithdrawalRequest memory _preStartRequest, WithdrawalRequest memory _endRequest) external view returns (uint256 shareRate, uint256 stETH, uint256 shares)
  {
    return _calcBatch(_preStartRequest, _endRequest);
  }

  function exposedClaim(uint256 _requestId, uint256 _hint, address _recipient) external {
    return _claim(_requestId, _hint, _recipient);
  }

  function exposedCalculateClaimableEther(uint256 _requestId, uint256 _hint) external view returns (uint256) {
    WithdrawalRequest storage request = _getQueue()[_requestId];

    return _calculateClaimableEther(request, _requestId, _hint);
  }

  function exposedInitializeQueue() external {
    _initializeQueue();
  }

  // Internal functions

  function exposedGetLastReportTimestamp() external view returns (uint256) {
    return _getLastReportTimestamp();
  }

  function exposedSetLastRequestId(uint256 _requestId) external {
    _setLastRequestId(_requestId);
  }

  function exposedSetLastFinalizedRequestId(uint256 _requestId) external {
    _setLastFinalizedRequestId(_requestId);
  }

  function exposedSetLastCheckpointIndex(uint256 _index) external {
    _setLastCheckpointIndex(_index);
  }

  function exposedSetLockedEtherAmount(uint256 _lockedEtherAmount) external {
    _setLockedEtherAmount(_lockedEtherAmount);
  }

  function exposedSetLastReportTimestamp(uint256 _timestamp) external {
    _setLastReportTimestamp(_timestamp);
  }
}