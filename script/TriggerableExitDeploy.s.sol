// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "../contracts/forge-std/Script.sol";
import "./../contracts/0.8.9/TriggerableExit.sol";

// forge script script/TriggerableExitDeploy.s.sol:TriggerableExitDeploy --fork-url http://localhost:8545
contract TriggerableExitDeploy is Script {
  
  function run() external {
    uint deployerPrivateKey = vm.envUint("PRIVATE_KEY");

    vm.startBroadcast(deployerPrivateKey);
    new TriggerableExit();

    vm.stopBroadcast();
  }
}
