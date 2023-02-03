// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import "../interfaces/IStakingModule.sol";
import {MemUtils} from "../../common/lib/MemUtils.sol";

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
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {
        exitedValidatorsCount = totalStoppedKeys;
        activeValidatorsKeysCount = totalUsedKeys - totalStoppedKeys;
        readyToDepositValidatorsKeysCount = totalKeys - totalUsedKeys;
    }

    function getValidatorsKeysStats(uint256 _nodeOperatorId)
        external
        view
        returns (
            uint256 exitedValidatorsCount,
            uint256 activeValidatorsKeysCount,
            uint256 readyToDepositValidatorsKeysCount
        )
    {}

    function getValidatorsKeysNonce() external view returns (uint256) {
        return keysOpIndex;
    }

    function getNodeOperatorsCount() external view returns (uint256) {}

    function getActiveNodeOperatorsCount() external view returns (uint256) {}

    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool) {}

    function getRewardsDistribution(uint256 _totalRewardShares)
        external
        view
        returns (address[] memory recipients, uint256[] memory shares)
    {}

    function getNodeOperatorKeysStats(uint56 _nodeOperatorId)
        external
        view
        returns (
            uint256 everDepositedKeysCount,
            uint256 everExitedKeysCount,
            uint256 readyToDepositKeysCount
        )
    {}

    function addNodeOperator(string memory _name, address _rewardAddress) external returns (uint256 id) {}

    function setNodeOperatorStakingLimit(uint256 _id, uint256 _stakingLimit) external {}

    function handleRewardsMinted(uint256 _totalShares) external {}

    function updateExitedValidatorsKeysCount(uint256, uint256) external returns (uint256) {
        return 0;
    }

    function finishUpdatingExitedValidatorsKeysCount() external {}

    function unsafeUpdateExitedValidatorsKeysCount(
        uint256 /* _nodeOperatorId */,
        uint256 /* _exitedValidatorsKeysCount */
    ) external returns (uint256)
    {
        return 0;
    }

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

    function invalidateReadyToDepositKeys() external {}

    function setType(bytes32 _type) external {
        moduleType = _type;
    }

    function getKeysOpIndex() external view returns (uint256) {
        return keysOpIndex;
    }

    function requestValidatorsKeysForDeposits(uint256 _keysCount, bytes calldata _calldata)
        external
        pure
        returns (
            uint256 keysCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {

        publicKeys = MemUtils.unsafeAllocateBytes(_keysCount * PUBKEY_LENGTH);
        signatures = MemUtils.unsafeAllocateBytes(_keysCount * SIGNATURE_LENGTH);
        MemUtils.copyBytesFrom(_calldata, publicKeys, 0, _keysCount * PUBKEY_LENGTH);
        MemUtils.copyBytesFrom(_calldata, signatures, _keysCount * PUBKEY_LENGTH, _keysCount * PUBKEY_LENGTH);

        return (_keysCount, publicKeys, signatures);
    }
}
