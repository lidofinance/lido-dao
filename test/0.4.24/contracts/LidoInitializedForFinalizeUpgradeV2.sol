// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.4.24;

import {Lido} from "contracts/0.4.24/Lido.sol";

contract LidoInitializedForFinalizeUpgradeV2 is Lido {
  function __initialize(uint256 _initialVersion) external payable {
    assert(address(this).balance != 0);
    _bootstrapInitialHolder();
    _setContractVersion(_initialVersion);
    initialized();
  }
}
