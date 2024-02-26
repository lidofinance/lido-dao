// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity >=0.8.0 <0.9.0;

import {Test, DSTest} from "../../contracts/forge-std/Test.sol";
import "../../contracts/0.8.9/TriggerableExit.sol";
import "../../contracts/forge-std/Vm.sol";
import "../../contracts/forge-std/console.sol";

// forge test -vv --match-path test/0.8.9/TriggerableExit.t.sol --match-contract TriggerableExit
contract TriggerableExitTest is Test {

    TriggerableExit trExit;
    address alice = makeAddr("alice");

    function setUp() public {
        trExit = new TriggerableExit();
    }

    function testSuccessDummy() public {
        uint amount = 0.1 ether;
        hoax(alice, 100 ether);

        bytes memory validatorPubkey = bytes("0x009145CCE52D386f254917e481eB44e9943F39138d96dg");
        trExit.triggerExit{value: amount}(validatorPubkey);
    }
}
