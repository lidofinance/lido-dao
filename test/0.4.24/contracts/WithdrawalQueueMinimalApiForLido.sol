// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;


contract WithdrawalQueueMinimalApiForLido {
  bool public isBunkerModeActive;
  uint256 public unfinalizedStETH;

  function _setBunkerMode(bool active) external {
    isBunkerModeActive = active;
  }

  function _setUnfinalizedStETH(uint256 amount) external {
    unfinalizedStETH = amount;
  }
}
