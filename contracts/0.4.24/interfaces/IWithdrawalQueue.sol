// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

interface IFinalizableWithdrawableQueue {
    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _shareRate
    ) external view returns (uint256 sharesToBurn, uint256 etherToLock);

    function finalize(
        uint256 _lastIdToFinalize,
        uint256 _etherToLock,
        uint256 _shareRate
    ) external payable;

    function restake(uint256 _amount) external;

    function finalizedRequestsCounter() external view returns (uint256);
}
