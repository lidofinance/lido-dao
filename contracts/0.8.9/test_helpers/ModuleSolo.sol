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


    function getValidatorsReport() external view returns (ValidatorsReport memory report) {
        report.totalExited = totalStoppedKeys;
        report.totalDeposited = totalUsedKeys;
        report.totalVetted = totalKeys;
    }

    function getValidatorsReport(uint256 _nodeOperatorId) external view returns (ValidatorsReport memory report) {}


    function getDepositsDataNonce() external view returns (uint256) {
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

    function updateStuckValidatorsCount(
        uint256 _nodeOperatorId,
        uint256 _stuckValidatorKeysCount
    ) external {}

    function updateExitedValidatorsCount(uint256, uint256) external returns (uint256) {
        return 0;
    }

    function finishUpdatingExitedValidatorsCount() external {}

    function unsafeUpdateValidatorsCount(
        uint256 /* _nodeOperatorId */,
        uint256 /* _exitedValidatorsKeysCount */,
        uint256 /* _stuckValidatorsKeysCount */
    ) external {}

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

    function invalidateDepositsData() external {}

    function setType(bytes32 _type) external {
        moduleType = _type;
    }

    function getKeysOpIndex() external view returns (uint256) {
        return keysOpIndex;
    }

    function provideDepositsData(uint256 _depositsCount, bytes calldata _calldata)
        external
        pure
        returns (
            uint256 depositsCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {

        publicKeys = MemUtils.unsafeAllocateBytes(_depositsCount * PUBKEY_LENGTH);
        signatures = MemUtils.unsafeAllocateBytes(_depositsCount * SIGNATURE_LENGTH);
        MemUtils.copyBytes(_calldata, publicKeys, 0, 0, _depositsCount * PUBKEY_LENGTH);
        MemUtils.copyBytes(_calldata, signatures, _depositsCount * PUBKEY_LENGTH, 0, _depositsCount * PUBKEY_LENGTH);

        return (_depositsCount, publicKeys, signatures);
    }
}
