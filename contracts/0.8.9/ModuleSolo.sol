// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.9;

import "./interfaces/IStakingModule.sol";
import "./lib/BytesLib.sol";

interface IStakingRouter {
    function deposit(bytes memory pubkeys, bytes memory signatures) external returns (uint256);
}

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

    function getTotalKeys() external view returns (uint256) {
        return totalKeys;
    }

    function getTotalUsedKeys() external view returns (uint256) {
        return totalUsedKeys;
    }

    function getTotalStoppedKeys() external view returns (uint256) {
        return totalStoppedKeys;
    }

    function getSigningKeysStats()
        external
        view
        returns (
            uint256 totalSigningKeys,
            uint256 usedSigningKeys,
            uint256 stoppedSigningKeys
        )
    {
        totalSigningKeys = totalKeys;
        usedSigningKeys = totalUsedKeys;
        stoppedSigningKeys = totalStoppedKeys;
    }

    function getRewardsDistribution(uint256 _totalRewardShares)
        external
        view
        returns (address[] memory recipients, uint256[] memory shares)
    {}

    function addNodeOperator(string memory _name, address _rewardAddress) external returns (uint256 id) {}

    function setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit) external {}

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

    function trimUnusedKeys() external {}

    function setType(bytes32 _type) external {
        moduleType = _type;
    }

    function getType() external view returns (bytes32) {
        return moduleType;
    }

    function getKeysOpIndex() external view returns (uint256) {
        return keysOpIndex;
    }

    function prepNextSigningKeys(uint256 maxDepositsCount, bytes calldata depositCalldata)
        external
        pure
        returns (
            uint256 keysCount,
            bytes memory pubkeys,
            bytes memory signatures
        )
    {
        pubkeys = BytesLib.slice(depositCalldata, 0, maxDepositsCount * PUBKEY_LENGTH);
        signatures = BytesLib.slice(
            depositCalldata,
            maxDepositsCount * PUBKEY_LENGTH,
            maxDepositsCount * SIGNATURE_LENGTH
        );

        return (maxDepositsCount, pubkeys, signatures);
    }
}
