// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * @notice an interface for witdrawal queue. See `WithdrawalQueue.sol` for docs
 */
interface IWithdrawalQueue {
    function enqueue(
        address _recipient, 
        uint256 _etherAmount, 
        uint256 _sharesAmount
    ) external returns (uint256 requestId);

    function claim(uint256 _requestId, uint256 _priceIndexHint) external returns (address recipient);

    function calculateFinalizationParams(
        uint256 _lastIdToFinalize,
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external view returns (uint256 sharesToBurn, uint256 etherToLock);

    function finalize(
        uint256 _lastIdToFinalize,
        uint256 _etherToLock, 
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external payable;

    function restake(uint256 _amount) external;

    function queue(uint256 _requestId) external view returns (
        address recipient, 
        uint96 requestBlockNumber, 
        uint128 cumulativeEtherToWithdraw, 
        uint128 cumulativeSharesToBurn, 
        bool claimed
    );
    function finalizedQueueLength() external view returns (uint256);
}
