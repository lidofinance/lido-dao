// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.8.9;

contract LidoLocatorPartialReturningOnlyWithdrawalQueueAndBurner {
  address public immutable withdrawalQueue;
  address public immutable burner;

  constructor(address _withdrawalQueue, address _burner) {
    withdrawalQueue = _withdrawalQueue;
    burner = _burner;
  }
}
