// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import "contracts/0.8.9/WithdrawalQueue.sol";

contract WithdrawalsQueueHarness is WithdrawalQueue {

  constructor(address _wstETH) WithdrawalQueue(IWstETH(_wstETH)) {}

  function exposedGetClaimableEther(uint256 _requestId, uint256 _hint) external view returns (uint256) {
    return _getClaimableEther(_requestId, _hint);
  }

  function exposedFinalize(uint256 _lastRequestIdToBeFinalized, uint256 _maxShareRate) external payable {
    _finalize(_lastRequestIdToBeFinalized, msg.value, _maxShareRate);
  }

  function _emitTransfer(address _from, address _to, uint256 _requestId) internal override {
    // do nothing
  }
}