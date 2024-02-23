// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;

contract WithdrawalQueue__MockForLidoMisc {
  bool public isBunkerModeActive;

  // test helpers

  function mock__bunkerMode(bool active) external {
    isBunkerModeActive = active;
  }
}
