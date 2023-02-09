// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {StakingRouter} from "../munged/StakingRouter.sol";

contract StakingRouterHarness is StakingRouter {
    constructor(address _depositContract) StakingRouter(_depositContract) {}

    function getStakingModuleAddressById(uint256 _stakingModuleId) public view returns (address) {
        return _getStakingModuleAddressById(_stakingModuleId);
    }

    function getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) public view returns (address) {
        return _getStakingModuleAddressByIndex(_stakingModuleIndex);
    }
}
