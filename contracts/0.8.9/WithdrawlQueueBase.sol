// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

/**
 * @title A dedicated contract for handling stETH withdrawal request queue
 * @author folkyatina
 */
abstract contract WithdrawalQueueBase {
    /// @notice precision base for share rate and discounting factor values in the contract
    uint256 public constant E27_PRECISION_BASE = 1e27;

    /// @notice structure representing a request for withdrawal.
    struct WithdrawalRequest {
        /// @notice sum of the all stETH submitted for withdrawals up to this request
        uint128 cumulativeStETH;
        /// @notice sum of the all shares locked for withdrawal up to this request
        uint128 cumulativeShares;
        /// @notice payable address of the recipient eth will be transferred to
        address payable recipient;
        /// @notice block.number when the request was created
        uint64 blockNumber;
        /// @notice flag if the request was claimed
        bool claimed;
    }

    /// @notice structure representing a discount that is applied to request batch on finalization
    struct Discount {
        /// @notice discount factor with 1e27 precision (0 - 100% discount, 1e27 - means no discount)
        uint256 discountFactor;
        /**
         * @notice last index in queue the discount is applicable to
         * @dev the `discountingFactor` is valid for (`previuosIndex`, `index`]
         */
        uint256 indexInQueue;
    }

    /// @notice Emitted when a new withdrawal request enqueued
    /// @dev Contains both stETH token amount and its corresponding shares amount
    event WithdrawalRequested(
        uint256 indexed requestId,
        address indexed requestor,
        address indexed recipient,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, address initiator);

    error RecipientZeroAddress();
    error SenderExpected(address _recipient, address _msgSender);
    error InvalidFinalizationId();
    error NotEnoughEther();
    error RequestNotFinalized();
    error RequestAlreadyClaimed();
    error InvalidHint();
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
    uint128 public lockedEtherAmount = 0;

    /// @notice length of the finalized part of the queue
    uint256 public finalizedRequestsCounter = 0;

    /// @notice queue for withdrawal requests
    WithdrawalRequest[] internal queue;

    /// @notice finalization discount history
    Discount[] public discountHistory;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) public requestsByRecipient;

    /// @notice Returns the length of the withdrawal request queue
    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /// @notice return number of unfinalized requests in the queue
    function unfinalizedQueueLength() external view returns (uint256) {
        return queue.length - finalizedRequestsCounter;
    }

    /// @notice amount of stETH yet to be finalized
    function unfinalizedStETH() external view returns (uint256 stETHAmountToFinalize) {
        stETHAmountToFinalize = 0;
        if (queue.length > 0) {
            stETHAmountToFinalize = queue[queue.length - 1].cumulativeStETH;
            if (finalizedRequestsCounter > 0) {
                stETHAmountToFinalize -= queue[finalizedRequestsCounter - 1].cumulativeStETH;
            }
        }
    }

    /// @notice Returns all withdrawal requests placed for the `_recipient` address
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient];
    }

    /**
     * @notice Returns status of the withdrawal request
     * @param _requestId id of the request
     */
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
        )
    {
        if (_requestId < queue.length) {
            WithdrawalRequest memory request = queue[_requestId];

            recipient = request.recipient;
            blockNumber = request.blockNumber;

            amountOfShares = request.cumulativeShares;
            amountOfStETH = request.cumulativeStETH;
            if (_requestId > 0) {
                amountOfShares -= queue[_requestId - 1].cumulativeShares;
                amountOfStETH -= queue[_requestId - 1].cumulativeStETH;
            }

            isFinalized = _requestId < finalizedRequestsCounter;
            isClaimed = request.claimed;
        }
    }

    /**
     * @notice returns the amount of ETH to be send along to finalize this batch and the amount of shares to burn after
     * @param _lastRequestIdToFinalize the index in the request queue that should be used as the end of the batch
     * @param _shareRate share rate that will be used to calculate the batch value
     *
     * @return eth amount of ETH required to finalize the batch
     * @return shares amount of shares that should be burned on finalization
     */
    function finalizationBatch(uint256 _lastRequestIdToFinalize, uint256 _shareRate)
        external
        view
        returns (uint128 eth, uint128 shares)
    {
        (eth, shares) = _batch(finalizedRequestsCounter, _lastRequestIdToFinalize);
        uint256 batchValue = shares * _shareRate / E27_PRECISION_BASE;
        uint256 discountFactor = _calculateDiscountFactor(eth, batchValue);
        eth = _applyDiscount(eth, discountFactor);
    }

    /**
     * @notice Transfer the right to claim withdrawal to another `_newRecipient`
     * @dev should be called by the old recepient
     * @param _requestId id of the request subject to change
     * @param _newRecipient new recipient address for withdrawal
     */
    function changeRecipient(uint256 _requestId, address _newRecipient) external {
        if (_newRecipient == address(0)) revert RecipientZeroAddress();

        WithdrawalRequest storage request = queue[_requestId];

        if (msg.sender != request.recipient) revert SenderExpected(request.recipient, msg.sender);
        if (request.claimed) revert RequestAlreadyClaimed();

        request.recipient = payable(_newRecipient);
    }

    /**
     * @notice view function to find a proper Discount offchain to pass it to `claim()` later
     * @param _requestId request id to be claimed later
     *
     * @return hint discount index for this request
     */
    function findClaimHint(uint256 _requestId) public view returns (uint256 hint) {
        // binary search
        if (_requestId >= finalizedRequestsCounter) revert InvalidHint();

        for (uint256 i = discountHistory.length; i > 0; i--) {
            if (_isHintValid(_requestId, i - 1)) {
                return i - 1;
            }
        }
        assert(false);
    }

    /**
     * @notice Claim `_requestId` request and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _hint rate index found offchain that should be used for claiming
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) external {
        if (_requestId >= finalizedRequestsCounter) revert RequestNotFinalized();

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed();

        request.claimed = true;

        Discount memory discount;
        if (_isHintValid(_requestId, _hint)) {
            discount = discountHistory[_hint];
        } else {
            revert InvalidHint();
        }

        (uint128 ethToSend,) = _batch(_requestId, _requestId);
        ethToSend = _applyDiscount(ethToSend, discount.discountFactor);

        lockedEtherAmount -= ethToSend;

        _sendValue(request.recipient, ethToSend);

        emit WithdrawalClaimed(_requestId, request.recipient, msg.sender);
    }

    /// @dev creates a new `WithdrawalRequest` in the queue
    function _enqueue(uint256 _amountOfStETH, uint256 _amountofShares, address _recipient)
        internal
        returns (uint256 requestId)
    {
        requestId = queue.length;

        uint256 cumulativeShares = _amountofShares;
        uint256 cumulativeStETH = _amountOfStETH;

        if (requestId > 0) {
            WithdrawalRequest memory prevRequest = queue[requestId - 1];

            cumulativeShares += prevRequest.cumulativeShares;
            cumulativeStETH += prevRequest.cumulativeStETH;
        }

        queue.push(
            WithdrawalRequest(
                _toUint128(cumulativeStETH),
                _toUint128(cumulativeShares),
                payable(_recipient),
                _toUint64(block.number),
                false
            )
        );

        requestsByRecipient[msg.sender].push(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, _amountofShares);
    }

    /// @dev Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    function _finalize(uint256 _lastRequestIdToFinalize, uint256 _amountofETH) internal {
        if (_lastRequestIdToFinalize < finalizedRequestsCounter || _lastRequestIdToFinalize >= queue.length) {
            revert InvalidFinalizationId();
        }

        (uint128 amountOfStETH,) = _batch(finalizedRequestsCounter, _lastRequestIdToFinalize);
        uint256 discountFactor = _calculateDiscountFactor(amountOfStETH, _amountofETH);

        _updateDiscountHistory(discountFactor, _lastRequestIdToFinalize);

        lockedEtherAmount += _applyDiscount(amountOfStETH, discountFactor);
        finalizedRequestsCounter = _lastRequestIdToFinalize + 1;
    }

    /// @dev calculates the sum of stETH and shares for all requests in [`_firstId`, `_lastId`]
    function _batch(uint256 _firstId, uint256 _lastId)
        internal
        view
        returns (uint128 amountOfStETH, uint128 amountOfShares)
    {
        amountOfStETH = queue[_lastId].cumulativeStETH;
        amountOfShares = queue[_lastId].cumulativeShares;

        if (_firstId > 0) {
            amountOfStETH -= queue[_firstId - 1].cumulativeStETH;
            amountOfShares -= queue[_firstId - 1].cumulativeShares;
        }
    }

    /// @dev returns discount factor for finalization
    function _calculateDiscountFactor(uint256 _requestedValue, uint256 _realValue) internal pure returns (uint256) {
        if (_requestedValue > _realValue) {
            return _realValue * E27_PRECISION_BASE / _requestedValue;
        }
        return E27_PRECISION_BASE;
    }

    /// @dev apply discount factor to the given amount of tokens
    function _applyDiscount(uint128 _amountOfStETH, uint256 _discountFactor) internal pure returns (uint128) {
        return _toUint128(_amountOfStETH * _discountFactor / E27_PRECISION_BASE);
    }

    /// @dev checks if provided request included in the discount hint boundaries
    function _isHintValid(uint256 _requestId, uint256 _indexHint) internal view returns (bool isInRange) {
        uint256 rightBoundary = discountHistory[_indexHint].indexInQueue;

        isInRange = _requestId <= rightBoundary;
        if (_indexHint > 0) {
            uint256 leftBoundary = discountHistory[_indexHint - 1].indexInQueue;

            isInRange = isInRange && leftBoundary < _requestId;
        }
    }

    /// @dev add a new entry to discount history or modify the last one if discount does not change
    function _updateDiscountHistory(uint256 _discountFactor, uint256 _index) internal {
        if (discountHistory.length == 0) {
            discountHistory.push(Discount(_discountFactor, _index));
        } else {
            Discount storage previousDiscount = discountHistory[discountHistory.length - 1];

            if (_discountFactor == previousDiscount.discountFactor) {
                previousDiscount.indexInQueue = _index;
            } else {
                discountHistory.push(Discount(_discountFactor, _index));
            }
        }
    }

    function _min(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    function _toUint64(uint256 _value) internal pure returns (uint64) {
        if (_value > type(uint64).max) revert SafeCastValueDoesNotFit96Bits();
        return uint64(_value);
    }

    function _toUint128(uint256 _value) internal pure returns (uint128) {
        if (_value > type(uint128).max) revert SafeCastValueDoesNotFit128Bits();
        return uint128(_value);
    }
}
