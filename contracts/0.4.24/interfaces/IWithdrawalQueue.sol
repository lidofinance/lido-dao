// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * @notice WithdrawalQueue interface to be used in Lido.sol contract
 */
interface IWithdrawalQueue {
    function finalizationBatch(uint256 _lastRequestIdToFinalize, uint256 _shareRate) 
        external
        view 
        returns (uint128 eth, uint128 shares);

    function finalize(uint256 _lastIdToFinalize) external payable;

    function finalizedRequestsCounter() external view returns (uint256);

    function isPaused() external returns (bool);

    function getWithdrawalRequestStatus(uint256 _requestId)
        external
        view
        returns (
            uint256 amountOfStETH,
            uint256 amountOfShares,
            address recipient,
            uint256 blockNumber,
            bool isFinalized,
            bool isClaimed
        );
}
