// SPDX-FileCopyrightText: 2026 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.25;

import {AccessControlEnumerable} from "@openzeppelin/contracts-v5.2/access/extensions/AccessControlEnumerable.sol";

import {ILidoLocator} from "contracts/common/interfaces/ILidoLocator.sol";
import {ITriggerableWithdrawalsGateway} from "contracts/common/interfaces/ITriggerableWithdrawalsGateway.sol";
import {
    WithdrawalIntent,
    FULL_WITHDRAWAL_WEIGHT_GWEI,
    MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI
} from "contracts/common/interfaces/WithdrawalIntent.sol";
import {PausableUntil} from "contracts/common/utils/PausableUntil.sol";

import {WithdrawalLimit, WithdrawalLimitData} from "contracts/0.8.25/lib/WithdrawalLimit.sol";

interface IWithdrawalVault {
    function addWithdrawalRequests(bytes[] calldata pubkeys, uint64[] calldata amounts) external payable;

    function getWithdrawalRequestFee() external view returns (uint256);
}

/**
 * @title TriggerableWithdrawalsGateway
 * @author Lido
 * @notice Single entry point for all EIP-7002 withdrawal requests (partial and full) in the protocol.
 *         Limits the total balance requested to be withdrawn per frame and forwards requests to the WithdrawalVault.
 */
contract TriggerableWithdrawalsGateway is ITriggerableWithdrawalsGateway, AccessControlEnumerable, PausableUntil {
    using WithdrawalLimit for bytes32;
    using WithdrawalLimit for WithdrawalLimitData;

    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RESUME_ROLE = keccak256("RESUME_ROLE");
    bytes32 public constant ADD_WITHDRAWAL_REQUEST_ROLE = keccak256("ADD_WITHDRAWAL_REQUEST_ROLE");
    bytes32 public constant TW_EXIT_LIMIT_MANAGER_ROLE = keccak256("TW_EXIT_LIMIT_MANAGER_ROLE");

    bytes32 public constant WITHDRAWAL_LIMIT_POSITION =
        keccak256("lido.TriggerableWithdrawalsGateway.withdrawalLimitGwei");

    ILidoLocator public immutable LOCATOR;

    /// @dev Ensures the contract's ETH balance is unchanged.
    modifier preservesEthBalance() {
        uint256 balanceBeforeCall = address(this).balance - msg.value;
        _;
        assert(address(this).balance == balanceBeforeCall);
    }

    constructor(
        address admin,
        address lidoLocator,
        uint256 maxWithdrawalLimitGwei,
        uint256 withdrawalLimitPerFrameGwei,
        uint256 frameDurationInSec
    ) {
        if (admin == address(0)) revert ZeroArgument("admin");
        if (lidoLocator == address(0)) revert ZeroArgument("lidoLocator");
        LOCATOR = ILidoLocator(lidoLocator);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setWithdrawalLimit(maxWithdrawalLimitGwei, withdrawalLimitPerFrameGwei, frameDurationInSec);
    }

    /**
     * @notice Resume the contract
     */
    function resume() external onlyRole(RESUME_ROLE) {
        _resume();
    }

    /**
     * @notice Pause the contract for a specified period
     * @param _duration pause duration in seconds (use `PAUSE_INFINITELY` for unlimited)
     */
    function pauseFor(uint256 _duration) external onlyRole(PAUSE_ROLE) {
        _pauseFor(_duration);
    }

    /**
     * @notice Pause the contract until a specified timestamp
     * @param _pauseUntilInclusive the last second to pause until inclusive
     */
    function pauseUntil(uint256 _pauseUntilInclusive) external onlyRole(PAUSE_ROLE) {
        _pauseUntil(_pauseUntilInclusive);
    }

    /**
     * @notice Submits withdrawal requests for all `intents` in order to the WithdrawalVault.
     *         A full withdrawal weighs FULL_WITHDRAWAL_WEIGHT_GWEI against the withdrawal limit,
     *         a partial withdrawal weighs its amount.
     * @param intents Withdrawal intents: `amount == 0` is a full withdrawal, `amount > 0` is a partial one (gwei)
     * @param refundRecipient Receiver of the unused fee; `address(0)` refunds to `msg.sender`
     */
    function triggerWithdrawals(
        WithdrawalIntent[] calldata intents,
        address refundRecipient
    ) external payable onlyRole(ADD_WITHDRAWAL_REQUEST_ROLE) preservesEthBalance whenResumed {
        if (msg.value == 0) revert ZeroArgument("msg.value");
        uint256 requestsCount = intents.length;
        if (requestsCount == 0) revert ZeroArgument("intents");

        bytes[] memory pubkeys = new bytes[](requestsCount);
        uint64[] memory amounts = new uint64[](requestsCount);
        uint256 totalWeightGwei = 0;

        for (uint256 i = 0; i < requestsCount; ++i) {
            uint64 amount = intents[i].amount;
            if (amount > MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI) revert WithdrawalAmountTooLarge(i, amount);

            pubkeys[i] = intents[i].pubkey;
            amounts[i] = amount;
            totalWeightGwei += amount == 0 ? FULL_WITHDRAWAL_WEIGHT_GWEI : amount;
        }

        _consumeWithdrawalLimit(totalWeightGwei);

        IWithdrawalVault withdrawalVault = IWithdrawalVault(LOCATOR.withdrawalVault());
        uint256 totalFee = requestsCount * withdrawalVault.getWithdrawalRequestFee();
        uint256 refund = _checkFee(totalFee);

        withdrawalVault.addWithdrawalRequests{value: totalFee}(pubkeys, amounts);

        emit WithdrawalsTriggered(msg.sender, requestsCount, totalWeightGwei);

        _refundFee(refund, refundRecipient);
    }

    /**
     * @notice Sets the withdrawal limit
     * @param maxWithdrawalLimitGwei Maximum quota, in gwei, that can be accumulated, at least FULL_WITHDRAWAL_WEIGHT_GWEI
     * @param withdrawalLimitPerFrameGwei Quota, in gwei, restored per frame
     * @param frameDurationInSec Frame duration, in seconds, after which `withdrawalLimitPerFrameGwei` is restored
     */
    function setWithdrawalLimit(
        uint256 maxWithdrawalLimitGwei,
        uint256 withdrawalLimitPerFrameGwei,
        uint256 frameDurationInSec
    ) external onlyRole(TW_EXIT_LIMIT_MANAGER_ROLE) {
        _setWithdrawalLimit(maxWithdrawalLimitGwei, withdrawalLimitPerFrameGwei, frameDurationInSec);
    }

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
        )
    {
        WithdrawalLimitData memory limitData = WITHDRAWAL_LIMIT_POSITION.load();
        maxWithdrawalLimitGwei = limitData.maxLimit;
        withdrawalLimitPerFrameGwei = limitData.limitPerFrame;
        frameDurationInSec = limitData.frameDurationInSec;
        prevWithdrawalLimitGwei = limitData.prevLimit;
        currentWithdrawalLimitGwei = limitData.calculateCurrentLimit(_getTimestamp());
    }

    function _checkFee(uint256 fee) internal view returns (uint256 refund) {
        if (msg.value < fee) {
            revert InsufficientFee(fee, msg.value);
        }
        unchecked {
            refund = msg.value - fee;
        }
    }

    function _refundFee(uint256 refund, address recipient) internal {
        if (refund > 0) {
            if (recipient == address(0)) {
                recipient = msg.sender;
            }

            (bool success, ) = recipient.call{value: refund}("");
            if (!success) {
                revert FeeRefundFailed();
            }
        }
    }

    function _getTimestamp() internal view virtual returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }

    function _setWithdrawalLimit(
        uint256 maxWithdrawalLimitGwei,
        uint256 withdrawalLimitPerFrameGwei,
        uint256 frameDurationInSec
    ) internal {
        // A lower limit or no restoration could leave a full withdrawal unable to ever fit
        if (maxWithdrawalLimitGwei < FULL_WITHDRAWAL_WEIGHT_GWEI) {
            revert TooSmallMaxWithdrawalLimit(maxWithdrawalLimitGwei);
        }
        if (withdrawalLimitPerFrameGwei == 0) revert ZeroArgument("withdrawalLimitPerFrameGwei");

        WITHDRAWAL_LIMIT_POSITION
            .load()
            .setLimits(maxWithdrawalLimitGwei, withdrawalLimitPerFrameGwei, frameDurationInSec, _getTimestamp())
            .store(WITHDRAWAL_LIMIT_POSITION);

        emit WithdrawalLimitSet(maxWithdrawalLimitGwei, withdrawalLimitPerFrameGwei, frameDurationInSec);
    }

    function _consumeWithdrawalLimit(uint256 weightGwei) internal {
        WithdrawalLimitData memory limitData = WITHDRAWAL_LIMIT_POSITION.load();
        uint256 timestamp = _getTimestamp();
        uint256 limitGwei = limitData.calculateCurrentLimit(timestamp);

        if (weightGwei > limitGwei) {
            revert WithdrawalLimitExceeded(weightGwei, limitGwei);
        }

        limitData.updatePrevLimit(limitGwei - weightGwei, timestamp).store(WITHDRAWAL_LIMIT_POSITION);
    }

    /**
     * @notice Emitted when withdrawal requests are submitted
     * @param caller Address that submitted the requests
     * @param requestsCount Number of submitted requests
     * @param weightGwei Withdrawal limit consumed by the requests, in gwei
     */
    event WithdrawalsTriggered(address indexed caller, uint256 requestsCount, uint256 weightGwei);

    /**
     * @notice Emitted when the withdrawal limit is set
     * @param maxWithdrawalLimitGwei Maximum quota, in gwei, that can be accumulated
     * @param withdrawalLimitPerFrameGwei Quota, in gwei, restored per frame
     * @param frameDurationInSec Frame duration in seconds
     */
    event WithdrawalLimitSet(
        uint256 maxWithdrawalLimitGwei,
        uint256 withdrawalLimitPerFrameGwei,
        uint256 frameDurationInSec
    );

    /**
     * @notice Thrown when an invalid zero value is passed
     * @param name Name of the argument that was zero
     */
    error ZeroArgument(string name);

    /**
     * @notice Thrown when the passed fee is insufficient to cover all requests
     * @param feeRequired Fee required to cover all requests
     * @param passedValue Fee passed with the call
     */
    error InsufficientFee(uint256 feeRequired, uint256 passedValue);

    /**
     * @notice Thrown when the fee refund failed
     */
    error FeeRefundFailed();

    /**
     * @notice Thrown when the remaining withdrawal limit is not enough to cover the requests
     * @param requestedGwei Weight of the requests in gwei
     * @param remainingGwei Remaining withdrawal limit in gwei
     */
    error WithdrawalLimitExceeded(uint256 requestedGwei, uint256 remainingGwei);

    /**
     * @notice Thrown when a partial withdrawal amount exceeds MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI
     * @param index Index of the invalid intent in the passed array
     * @param amount Requested amount in gwei
     */
    error WithdrawalAmountTooLarge(uint256 index, uint256 amount);

    /**
     * @notice Thrown when the max withdrawal limit is below FULL_WITHDRAWAL_WEIGHT_GWEI
     * @param maxWithdrawalLimitGwei Passed max withdrawal limit in gwei
     */
    error TooSmallMaxWithdrawalLimit(uint256 maxWithdrawalLimitGwei);
}
