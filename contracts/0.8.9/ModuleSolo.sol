// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import "./interfaces/IStakingModule.sol";
import "./lib/BytesLib.sol";

contract ModuleSolo is IStakingModule {
    address private stakingRouter;
    address public immutable lido;

    uint256 public totalKeys;
    uint256 public totalUsedKeys;
    uint256 public totalStoppedKeys;

    bytes32 public moduleType;

    uint16 public keysOpIndex;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    constructor(address _lido) {
        lido = _lido;
    }

    function getType() external view returns (bytes32) {
        return moduleType;
    }

    function getValidatorsKeysStats()
        external
        view
        returns (
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {
        exitedValidatorsCount = uint64(totalStoppedKeys);
        depositedValidatorsCount = uint64(totalUsedKeys);
        approvedValidatorsKeysCount = uint64(totalKeys);
        totalValidatorsKeysCount = uint64(totalKeys);
    }

    function getValidatorsKeysNonce() external view returns (uint256) {
        return keysOpIndex;
    }

    function getNodeOperatorsCount() external view returns (uint24) {}

    function getActiveNodeOperatorsCount() external view returns (uint24) {}

    function getNodeOperatorIsActive(uint24 _nodeOperatorId) external view returns (bool) {}

    function getNodeOperatorValidatorsKeysStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 exitedValidatorsCount,
            uint64 depositedValidatorsCount,
            uint64 approvedValidatorsKeysCount,
            uint64 totalValidatorsKeysCount
        )
    {}

    function getRewardsDistribution(uint256 _totalRewardShares)
        external
        view
        returns (address[] memory recipients, uint256[] memory shares)
    {}

    function getNodeOperatorKeysStats(uint24 _nodeOperatorId)
        external
        view
        returns (
            uint64 everDepositedKeysCount,
            uint64 everExitedKeysCount,
            uint64 readyToDepositKeysCount
        )
    {}

    function addNodeOperator(string memory _name, address _rewardAddress) external returns (uint256 id) {}

    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external {}

    function updateNodeOperatorExitedValidatorsKeysCount(uint24 _nodeOperatorId, uint64 _newEverExitedKeysCount) external {}

    function addSigningKeys(
        uint256 _operator_id,
        uint256 _quantity,
        bytes memory _pubkeys,
        bytes memory _signatures
    ) external {}

    function addSigningKeysOperatorBH(
        uint256 _operator_id,
        uint256 _quantity,
        bytes memory _pubkeys,
        bytes memory _signatures
    ) external {}

    //only for testing purposal
    function setTotalKeys(uint256 _keys) external {
        totalKeys = _keys;
    }

    function setTotalUsedKeys(uint256 _keys) external {
        totalUsedKeys = _keys;
    }

    function setTotalStoppedKeys(uint256 _keys) external {
        totalStoppedKeys = _keys;
    }

    function setNodeOperatorActive(uint256 _id, bool _active) external {}

    function setStakingRouter(address _addr) public {
        stakingRouter = _addr;

        //emit SetStakingRouter(_addr);
    }

    function getStakingRouter() external view returns (address) {
        return stakingRouter;
    }

    function trimUnusedValidatorsKeys() external {}

    function setType(bytes32 _type) external {
        moduleType = _type;
    }

    function getKeysOpIndex() external view returns (uint256) {
        return keysOpIndex;
    }

    function enqueueApprovedValidatorsKeys(uint64 _keysCount, bytes calldata _calldata)
        external
        pure
        returns (
            uint64 enqueuedValidatorsKeysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {
        publicKeys = BytesLib.slice(_calldata, 0, _keysCount * PUBKEY_LENGTH);
        signatures = BytesLib.slice(_calldata, _keysCount * PUBKEY_LENGTH, _keysCount * SIGNATURE_LENGTH);

        return (_keysCount, publicKeys, signatures);
    }
}
