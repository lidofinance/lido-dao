// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import "contracts/0.8.9/WithdrawalQueue.sol";

contract WithdrawalsQueueHarness is WithdrawalQueue {

  event Mock__Transfer(address indexed from, address indexed to, uint256 requestId);

  constructor(address _wstETH) WithdrawalQueue(IWstETH(_wstETH)) {}

  function exposedEnqueue(uint128 _amountOfStETH, uint128 _amountOfShares, address _owner) external returns (uint256 requestId) {
    return _enqueue(_amountOfStETH, _amountOfShares, _owner);
  }

  function exposedClaim(uint256 _requestId, uint256 _hint, address _recipient) external {
    return _claim(_requestId, _hint, _recipient);
  }

  function exposedGetClaimableEther(uint256 _requestId, uint256 _hint) external view returns (uint256) {
    return _getClaimableEther(_requestId, _hint);
  }

  function exposedFinalize(uint256 _lastRequestIdToBeFinalized, uint256 _maxShareRate) external payable {
    _finalize(_lastRequestIdToBeFinalized, msg.value, _maxShareRate);
  }

  function _emitTransfer(address _from, address _to, uint256 _requestId) internal override {
    emit Mock__Transfer(_from, _to, _requestId);
  }
}