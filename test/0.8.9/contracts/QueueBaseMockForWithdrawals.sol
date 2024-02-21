// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.8.9;

import "contracts/0.8.9/WithdrawalQueueBase.sol";

contract QueueBaseMockForWithdrawals is WithdrawalQueueBase {

  constructor() {
    _initializeQueue();
  }

  function enqueue(uint128 _amountOfStETH, uint128 _amountOfShares, address _owner) external returns (uint256 requestId) {
    return _enqueue(_amountOfStETH, _amountOfShares, _owner);
  }

  function finalize(uint256 _lastRequestIdToBeFinalized, uint256 _amountOfETH, uint256 _maxShareRate) external {
    _finalize(_lastRequestIdToBeFinalized, _amountOfETH, _maxShareRate);
  }

  function getStatus(uint256 _requestId) external view returns (WithdrawalRequestStatus memory status) {
    return _getStatus(_requestId);
  }

  function sendValue(address _recipient, uint256 _amount) external {
    return _sendValue(_recipient, _amount);
  }

  // Internal functions

  function getLastReportTimestamp() external view returns (uint256) {
    return _getLastReportTimestamp();
  }

  function setLastRequestId(uint256 _requestId) external {
    _setLastRequestId(_requestId);
  }

  function setLastFinalizedRequestId(uint256 _requestId) external {
    _setLastFinalizedRequestId(_requestId);
  }

  function setLastCheckpointIndex(uint256 _index) external {
    _setLastCheckpointIndex(_index);
  }

  function setLockedEtherAmount(uint256 _lockedEtherAmount) external {
    _setLockedEtherAmount(_lockedEtherAmount);
  }

  function setLastReportTimestamp(uint256 _timestamp) external {
    _setLastReportTimestamp(_timestamp);
  }
}