// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "./IModule.sol";

contract ModuleSolo is IModule {

    address immutable public lido;
    uint16 immutable public fee;
    uint256 immutable public bond;
    uint16 immutable public treasuryFee;

    uint256 public totalKeys;
    uint256 public totalUsedKeys;
    uint256 public totalStoppedKeys;
    uint256 public totalWithdrawnKeys;
    
    ModuleType public moduleType;

    constructor(ModuleType _type, address _lido, uint16 _fee, uint16 _treasuryFee,  uint256 _bond) {
        require(ModuleType.DVT >= _type, "INVALID_TYPE");

        lido = _lido;
        bond = _bond;
        fee = _fee;
        treasuryFee = _treasuryFee;
        moduleType = _type;
    } 

    function getFee() external view returns (uint16) {
        return fee+treasuryFee;
    }

    function getTotalKeys() external view returns (uint256) {
        return totalKeys;
    }     

    function getTotalUsedKeys() external view returns (uint256) {
        return totalUsedKeys;
    }

    function getTotalStoppedKeys() external view returns(uint256) {
        return totalStoppedKeys;
    }

    function getTotalWithdrawnKeys() external view returns(uint256) {
        return totalWithdrawnKeys;
    }

    function getRewardsDistribution(uint256 _totalRewardShares) external view
        returns (
            address[] memory recipients,
            uint256[] memory shares
        )
    {
        
    }

    function assignNextSigningKeys(uint256 _numKeys) external returns (bytes memory pubkeys, bytes memory signatures) {

    }

    function addNodeOperator(string memory _name, address _rewardAddress) external returns (uint256 id) {}
    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external {}
    function addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) external {}
    function addSigningKeysOperatorBH(uint256 _operator_id, uint256 _quantity, bytes memory _pubkeys, bytes memory _signatures) external {}

    //only for testing purposal
    function setTotalKeys(uint256 _keys) external { totalKeys = _keys; }
    function setTotalUsedKeys(uint256 _keys) external { totalUsedKeys = _keys; }
    function setTotalStoppedKeys(uint256 _keys) external { totalStoppedKeys = _keys; }
    function setTotalWithdrawnKeys(uint256 _keys) external { totalWithdrawnKeys = _keys; }

    function setNodeOperatorActive(uint256 _id, bool _active) external {}
}