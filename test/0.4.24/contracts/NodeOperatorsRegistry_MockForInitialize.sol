// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;

import {NodeOperatorsRegistry} from "contracts/0.4.24/nos/NodeOperatorsRegistry.sol";

contract NodeOperatorsRegistry__MockForInitialize is NodeOperatorsRegistry {
  function mock__initialize(uint256 _initialVersion) external {
    _setContractVersion(_initialVersion);
    initialized();
  }
}
