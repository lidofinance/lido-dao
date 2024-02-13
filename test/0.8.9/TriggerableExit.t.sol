// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity >=0.8.0 <0.9.0;

import {DSTest} from "../../contracts/forge-std/Test.sol";
import "../../contracts/forge-std/console.sol";
import "../../contracts/0.8.9/TriggerableExit.sol";

// forge test -v --match-path test/0.8.9/TriggerableExit.t.sol --match-contract TriggerableExit
contract TriggerableExitTest is DSTest {

    TriggerableExit trExit;

    function setUp() public {
        trExit = new TriggerableExit();

        bytes memory validatorPubkey = bytes("0x009145CCE52D386f254917e481eB44e9943F39138d96dg");

        trExit.insertExitToQueue(validatorPubkey);
    }

    function testSuccessDummy() public {
        assertEq(trExit.dummy(), 1);
    }
}
