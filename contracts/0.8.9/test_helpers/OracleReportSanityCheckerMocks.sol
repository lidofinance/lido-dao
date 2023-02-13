// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IWithdrawalQueue} from "../sanity_checks/OracleReportSanityChecker.sol";

contract LidoStub {
    uint256 private _shareRate = 1 ether;

    function getSharesByPooledEth(uint256 _sharesAmount) external view returns (uint256) {
        return (_shareRate * _sharesAmount) / 1 ether;
    }

    function setShareRate(uint256 _value) external {
        _shareRate = _value;
    }
}

contract WithdrawalQueueStub {
    mapping(uint256 => uint256) private _blockNumbers;

    function setRequestBlockNumber(uint256 _requestId, uint256 _blockNumber) external {
        _blockNumbers[_requestId] = _blockNumber;
    }

    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256,
            uint256,
            address,
            uint256 blockNumber,
            bool,
            bool
        )
    {
        blockNumber = _blockNumbers[_requestId];
    }
}

interface ILidoLocator {
    function lido() external view returns (address);
    function withdrawalVault() external view returns (address);
    function withdrawalQueue() external view returns (address);
}

contract LidoLocatorStub is ILidoLocator {
    address private immutable LIDO;
    address private immutable WITHDRAWAL_VAULT;
    address private immutable WITHDRAWAL_QUEUE;
    address private immutable EL_REWARDS_VAULT;

    constructor(
        address _lido,
        address _withdrawalVault,
        address _withdrawalQueue,
        address _elRewardsVault
    ) {
        LIDO = _lido;
        WITHDRAWAL_VAULT = _withdrawalVault;
        WITHDRAWAL_QUEUE = _withdrawalQueue;
        EL_REWARDS_VAULT = _elRewardsVault;
    }

    function lido() external view returns (address) {
        return LIDO;
    }

    function withdrawalQueue() external view returns (address) {
        return WITHDRAWAL_QUEUE;
    }

    function withdrawalVault() external view returns (address) {
        return WITHDRAWAL_VAULT;
    }

    function elRewardsVault() external view returns (address) {
        return EL_REWARDS_VAULT;
    }
}

contract OracleReportSanityCheckerStub {
    error SelectorNotFound(bytes4 sig, uint256 value, bytes data);

    fallback() external payable { revert SelectorNotFound(msg.sig, msg.value, msg.data); }

    function checkAccountingOracleReport(
        uint256 _timeElapsed,
        uint256 _preCLBalance,
        uint256 _postCLBalance,
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        uint256 _preCLValidators,
        uint256 _postCLValidators
    ) external view {}

    function checkWithdrawalQueueOracleReport(
        uint256 _lastFinalizableRequestId,
        uint256 _simulatedShareRate,
        uint256 _reportTimestamp
    ) external view {}

    function checkSimulatedShareRate(
        uint256 _noWithdrawalsPostTotalPooledEther,
        uint256 _noWithdrawalsPostTotalShares,
        uint256 _simulatedShareRate
    ) external view {}

    function smoothenTokenRebase(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256 _withdrawalVaultBalance,
        uint256 _elRewardsVaultBalance,
        uint256 _etherToLockForWithdrawals
    ) external view returns (uint256 withdrawals, uint256 elRewards, uint256 sharesToBurnLimit) {
        withdrawals = _withdrawalVaultBalance;
        elRewards = _elRewardsVaultBalance;
        sharesToBurnLimit = _etherToLockForWithdrawals;
    }

    function checkAccountingExtraDataListItemsCount(uint256 _extraDataListItemsCount) external view {}
}
