// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * @notice WithdrawalQueue interface to be used in Lido.sol contract
 */
interface IWithdrawalQueue {
    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _shareRate
    ) external view returns (uint128 sharesToBurn, uint128 etherToLock);

    function finalize(
        uint256 _lastIdToFinalize,
        uint256 _shareRate
    ) external payable;

    function finalizedRequestsCounter() external view returns (uint256);

    function isPaused() external returns (bool);

    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            address recipient,
            uint256 requestBlockNumber,
            uint256 etherToWithdraw,
            uint256 shares,
            bool isFinalized,
            bool isClaimed
        );
}
