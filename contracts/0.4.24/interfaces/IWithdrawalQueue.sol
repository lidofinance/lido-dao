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
    ) external view returns (uint256 sharesToBurn, uint256 etherToLock);

    function finalize(
        uint256 _lastIdToFinalize,
        uint256 _shareRate
    ) external payable;

    function finalizedRequestsCounter() external view returns (uint256);
}
