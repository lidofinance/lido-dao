// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import { MinFirstAllocationStrategyFuzzTesting, MinFirstAllocationStrategyAllocateTestWrapper} from "./min-first-allocation-strategy.helpers.sol";
import {MinFirstAllocationStrategy} from "contracts/common/lib/MinFirstAllocationStrategy.sol";

/// @dev this contract is required to make Foundry invariants testing work
contract MinFirstAllocationStrategyAllocateTestWrapper_0_8_9 is MinFirstAllocationStrategyAllocateTestWrapper {}

contract MinFirstAllocationStrategyFuzzTesting_0_8_9 is MinFirstAllocationStrategyFuzzTesting {
    function setUp() external {
        testWrapper = new MinFirstAllocationStrategyAllocateTestWrapper_0_8_9();
    }
}
