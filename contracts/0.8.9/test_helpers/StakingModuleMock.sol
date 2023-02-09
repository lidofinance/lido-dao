// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IStakingModule, ValidatorsReport} from "../interfaces/IStakingModule.sol";

contract StakingModuleMock is IStakingModule {
    uint256 private _activeValidatorsCount;
    uint256 private _availableValidatorsCount;
    uint256 private _depositsDataNonce;

    function getActiveValidatorsCount() public view returns (uint256) {
        return _activeValidatorsCount;
    }

    function getAvailableValidatorsCount() public view returns (uint256) {
        return _availableValidatorsCount;
    }

    function getType() external view returns (bytes32) {}

    function getValidatorsReport() external view returns (ValidatorsReport memory report) {
        report.totalDeposited = _activeValidatorsCount;
        report.totalVetted = _activeValidatorsCount + _availableValidatorsCount;
    }

    function getValidatorsReport(uint256 _nodeOperatorId) external view returns (ValidatorsReport memory report) {
    }

    function getDepositsDataNonce() external view returns (uint256) {
        return _depositsDataNonce;
    }

    function setDepositsDataNonce(uint256 _newDepositsDataNonce) external {
        _depositsDataNonce = _newDepositsDataNonce;
    }

    function getNodeOperatorsCount() external view returns (uint256) {}

    function getActiveNodeOperatorsCount() external view returns (uint256) {}

    function getNodeOperatorIsActive(uint256 _nodeOperatorId) external view returns (bool) {}

    function getNodeOperatorIds(uint256 _offset, uint256 _limit)
        external
        view
        returns (uint256[] memory nodeOperatorIds) {}

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

    function invalidateDepositsData() external {
        _availableValidatorsCount = _activeValidatorsCount;
    }

    function provideDepositsData(uint256 _depositsCount, bytes calldata _calldata)
        external
        returns (
            uint256 depositsCount,
            bytes memory publicKeys,
            bytes memory signatures
        )
    {}

    function setActiveValidatorsCount(uint256 _newActiveValidatorsCount) external {
        _activeValidatorsCount = _newActiveValidatorsCount;
    }

    function setAvailableKeysCount(uint256 _newAvailableValidatorsCount) external {
        _availableValidatorsCount = _newAvailableValidatorsCount;
    }
}
