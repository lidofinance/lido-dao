// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {StakingRouter} from "../munged/StakingRouter.sol";
import {UnstructuredStorage} from "../../contracts/0.8.9/lib/UnstructuredStorage.sol";

contract StakingRouterHarness is StakingRouter {
    using UnstructuredStorage for bytes32;

    constructor(
        address admin, 
        address lido, 
        bytes32 withdrawalCredentials, 
        address depositContract) 
        StakingRouter(depositContract) {
            initialize(admin, lido, withdrawalCredentials);
        }

    function getStakingModuleAddressById(uint256 _stakingModuleId) public view returns (address) {
        return _getStakingModuleAddressById(_stakingModuleId);
    }

    function getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) public view returns (address) {
        return _getStakingModuleAddressByIndex(_stakingModuleIndex);
    }

    function getStakingModuleExitedValidatorsById(uint256 _stakingModuleId) public view returns (uint256) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.exitedValidatorsCount;
    }

    function getStakingModuleIdById(uint256 _stakingModuleId) public view returns (uint256) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.id;
    }

    function getStakingModuleFeeById(uint256 _stakingModuleId) public view returns (uint16) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.stakingModuleFee;
    }
    
    function getStakingModuleTreasuryFeeById(uint256 _stakingModuleId) public view returns (uint16) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.treasuryFee;
    }

    function getStakingModuleTargetShareById(uint256 _stakingModuleId) public view returns (uint16) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        return stakingModule.targetShare;
    }

    function getStakingModuleNameLengthByIndex(uint256 index) public view returns (uint256) {
        StakingModule storage stakingModule = _getStakingModuleByIndex(index);
        return bytes(stakingModule.name).length;
    }

    function getStakingModuleIndexById(uint256 _stakingModuleId) public view returns (uint256) {
        return _getStakingModuleIndexById(_stakingModuleId);
    }

    function getLastStakingModuleId() public view returns (uint24) {
        return uint24(LAST_STAKING_MODULE_ID_POSITION.getStorageUint256());
    }
}
