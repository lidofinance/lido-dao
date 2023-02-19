// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import { MinFirstAllocationStrategyFuzzTesting, MinFirstAllocationStrategyAllocateTestWrapper} from "./min-first-allocation-strategy.helpers.sol";
import {MinFirstAllocationStrategy} from "contracts/common/lib/MinFirstAllocationStrategy.sol";

/// @dev this contract is required to make Foundry invariants testing work
contract MinFirstAllocationStrategyAllocateTestWrapper_0_4_24 is MinFirstAllocationStrategyAllocateTestWrapper {}

contract MinFirstAllocationStrategyFuzzTesting_0_4_24 is MinFirstAllocationStrategyFuzzTesting {
    function setUp() external {
        testWrapper = new MinFirstAllocationStrategyAllocateTestWrapper_0_4_24();
    }
}
