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

    // Returns the first 2 bytes of the deposit_count as uint64
    function getDepositContractCount() public view returns (uint64) {
        bytes memory ret = DEPOSIT_CONTRACT.get_deposit_count();
        return uint64(uint8(ret[0])) + uint64(256*uint8(ret[1])); 
    }
}
