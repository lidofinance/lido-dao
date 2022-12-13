// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "./IStakingModule.sol";

interface IStakingRouter {
    function deposit(bytes memory pubkeys, bytes memory signatures) external returns(uint);
}

contract ModuleSolo is IStakingModule {

    address private stakingRouter;

    address immutable public lido;
    uint16 immutable public fee;

    uint256 public totalKeys;
    uint256 public totalUsedKeys;
    uint256 public totalStoppedKeys;
    
    uint16 public moduleType;

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public SIGNATURE_LENGTH = 96;

    constructor(uint16 _type, address _lido, uint16 _fee) {
        lido = _lido;
        fee = _fee;
        moduleType = _type;
    } 

    function getFee() external view returns (uint16) {
        return fee;
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

    function setNodeOperatorActive(uint256 _id, bool _active) external {}

    function deposit(bytes memory pubkeys, bytes memory signatures) external {
        require(pubkeys.length > 0, "INVALID_PUBKEYS");

        require(pubkeys.length % PUBKEY_LENGTH == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length % SIGNATURE_LENGTH == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint256 numKeys = pubkeys.length / PUBKEY_LENGTH;
        require(numKeys == signatures.length / SIGNATURE_LENGTH, "REGISTRY_INCONSISTENT_SIG_COUNT");

        uint keys = IStakingRouter(stakingRouter).deposit(pubkeys, signatures);

        totalUsedKeys += keys;

        require(numKeys == keys);
    }

    function setStakingRouter(address _addr) public {
        stakingRouter = _addr;

        //emit SetStakingRouter(_addr);
    }

    function getStakingRouter() external returns(address) {
        return stakingRouter;
    }



    function trimUnusedKeys() external {

    }

    function setType(uint16 _type) external {
        moduleType = _type;
    } 

    function getType() external returns(uint16) {
        return moduleType;
    }
}