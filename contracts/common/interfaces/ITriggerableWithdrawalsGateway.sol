// SPDX-FileCopyrightText: 2026 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
// solhint-disable-next-line lido/fixed-compiler-version
pragma solidity >=0.8.9 <0.9.0;

import {WithdrawalIntent} from "contracts/common/interfaces/WithdrawalIntent.sol";

/**
 * @title ITriggerableWithdrawalsGateway
 * @notice Single entry point for all EIP-7002 withdrawal requests (partial and full) in the protocol
 */
interface ITriggerableWithdrawalsGateway {
    /**
     * @notice Submits withdrawal requests for all `intents` in order.
     * @param intents Withdrawal intents: `amount == 0` is a full withdrawal, `amount > 0` is a partial one (gwei)
     * @param refundRecipient Receiver of the unused fee; `address(0)` refunds to `msg.sender`
     * @dev Reverts if the total weight of `intents` exceeds the remaining limit (no partial processing).
     */
    function triggerWithdrawals(WithdrawalIntent[] calldata intents, address refundRecipient) external payable;

    /**
     * @notice Sets the withdrawal limit: the total weight of requests, in gwei, that can be submitted.
     *         A partial withdrawal weighs its amount, a full withdrawal weighs 2048 ETH.
     * @param maxWithdrawalLimitGwei Maximum quota, in gwei, that can be accumulated
     * @param withdrawalLimitPerFrameGwei Quota, in gwei, restored per frame
     * @param frameDurationInSec Frame duration, in seconds, after which `withdrawalLimitPerFrameGwei` is restored
     */
    function setWithdrawalLimit(
        uint256 maxWithdrawalLimitGwei,
        uint256 withdrawalLimitPerFrameGwei,
        uint256 frameDurationInSec
    ) external;

    /**
     * @notice Returns the withdrawal limit parameters and state
     * @return maxWithdrawalLimitGwei Maximum quota, in gwei, that can be accumulated
     * @return withdrawalLimitPerFrameGwei Quota, in gwei, restored per frame
     * @return frameDurationInSec Frame duration in seconds
     * @return prevWithdrawalLimitGwei Quota, in gwei, left after the last update
     * @return currentWithdrawalLimitGwei Quota, in gwei, available now
     */
    function getWithdrawalLimitFullInfo()
        external
        view
        returns (
            uint256 maxWithdrawalLimitGwei,
            uint256 withdrawalLimitPerFrameGwei,
            uint256 frameDurationInSec,
            uint256 prevWithdrawalLimitGwei,
            uint256 currentWithdrawalLimitGwei
        );
}
