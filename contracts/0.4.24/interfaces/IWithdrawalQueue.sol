// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

/**
 * @notice an interface for witdrawal queue. See `WithdrawalQueue.sol` for docs
 */
interface IWithdrawalQueue {
    function enqueue(
        address _requestor, 
        uint256 _etherAmount, 
        uint256 _sharesAmount
    ) external returns (uint256 requestId);

    function finalize(
        uint256 _lastIdToFinalize, 
        uint256 _totalPooledEther,
        uint256 _totalShares
    ) external payable returns (uint sharesToBurn);

    function claim(uint256 _requestId) external returns (address recipient);
    function queue(uint256 _requestId) external view returns (address, uint, uint);
    function finalizedQueueLength() external view returns (uint);
}
