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
    uint96 public constant E27_PRECISION_BASE = 1e27;
    /// @notice discount factor value that means no discount applying
    uint96 public constant NO_DISCOUNT = E27_PRECISION_BASE;

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
        /// @notice last index the discount is applicable to. So, it is valid in (`previuosIndex`, `index`] range
        uint256 indexInQueue;
        /// @notice discount factor with 1e27 precision (0 - 100% discount, 1e27 - means no discount)
        uint96 discountFactor;
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

    error ZeroRecipientAddress();
    error ZeroRequestId();
    error SenderExpected(address _recipient, address _msgSender);
    error InvalidRequestId(uint256 _requestId);
    error NotEnoughEther();
    error RequestNotFinalized(uint256 _requestId);
    error RequestAlreadyClaimed();
    error InvalidHint(uint256 _hint);
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit64Bits();
    error SafeCastValueDoesNotFit96Bits();
    error SafeCastValueDoesNotFit128Bits();

    /// @notice queue for withdrawal requests
    /// @dev mapping for better upgradability
    mapping(uint256 => WithdrawalRequest) internal queue;

    /// @notice length of the queue
    uint256 public lastRequestId = 0;

    /// @notice length of the finalized part of the queue. Always <= `requestCounter`
    uint256 public lastFinalizedRequestId = lastRequestId;

    /// @notice finalization discount history
    /// @dev mapping for better upgradability
    mapping(uint256 => Discount) internal discountHistory;

    /// @notice size of discount history
    uint256 public lastDiscountIndex = 0;

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
    uint128 public lockedEtherAmount = 0;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => uint256[]) internal requestsByRecipient;

    function _initializeQueue() internal {
        // setting dummy zero structs in discountHistory and queue beginning
        // to avoid uint underflows and related if-branches
        queue[lastRequestId] = WithdrawalRequest(0, 0, payable(0), _toUint64(block.number), true);
        discountHistory[lastDiscountIndex] = Discount(lastRequestId, NO_DISCOUNT);
    }

    /// @notice return the number of unfinalized requests in the queue
    function unfinalizedRequestNumber() external view returns (uint256) {
        return lastRequestId - lastFinalizedRequestId;
    }

    /// @notice Returns the amount of stETH yet to be finalized
    function unfinalizedStETH() external view returns (uint256) {
        return queue[lastRequestId].cumulativeStETH - queue[lastFinalizedRequestId].cumulativeStETH;
    }

    /// @notice Returns all withdrawal requests placed for the `_recipient` address
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient];
    }

    /**
     * @notice Returns status of the withdrawal request
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
        if (_requestId == 0) revert ZeroRequestId();
        if (_requestId > lastRequestId) revert InvalidRequestId(_requestId);

        WithdrawalRequest memory request = queue[_requestId];

        recipient = request.recipient;
        blockNumber = request.blockNumber;

        amountOfShares = request.cumulativeShares;
        amountOfStETH = request.cumulativeStETH;
        if (_requestId > 0) {
            amountOfShares -= queue[_requestId - 1].cumulativeShares;
            amountOfStETH -= queue[_requestId - 1].cumulativeStETH;
        }

        isFinalized = _requestId <= lastFinalizedRequestId;
        isClaimed = request.claimed;
    }

    /**
     * @notice Returns the amount of ETH to be send along to finalize this batch and the amount of shares to burn after
     * @param _lastRequestIdToFinalize the index in the request queue that should be used as the end of the batch. Should be >= 1
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
        if (_lastRequestIdToFinalize <= lastFinalizedRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);
        if (_lastRequestIdToFinalize > lastRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);

        (eth, shares) = _batch(lastFinalizedRequestId, _lastRequestIdToFinalize);
        uint256 batchValue = shares * _shareRate / E27_PRECISION_BASE;
        uint96 discountFactor = _calculateDiscountFactor(eth, batchValue);
        eth = _applyDiscount(eth, discountFactor);
    }
    /**
     * @notice View function to find a hint to pass it to `claimWithdrawal()`.
     * @dev NB! OOG is possible if used onchain. See `findClaimHint(uint256 _requestId, uint256 _firstIndex, uint256 _lastIndex)`
     * @param _requestId request id to be claimed with this hint
     */

    function findClaimHintUnbounded(uint256 _requestId) public view returns (uint256) {
        return findClaimHint(_requestId, 0, lastDiscountIndex);
    }

    /**
     * @notice View function to find a hint for `claimWithdrawal()` in the range of `[_firstIndex, _lastIndex]`
     * @param _requestId request id to be claimed later
     * @param _firstIndex left boundary of the search range
     * @param _lastIndex right boundary of the search range
     *
     * @return the hint for `claimWithdrawal` to find the discount for the request
     */
    function findClaimHint(uint256 _requestId, uint256 _firstIndex, uint256 _lastIndex) public view returns (uint256) {
        if (_requestId == 0) revert ZeroRequestId();
        if (_requestId > lastFinalizedRequestId) revert RequestNotFinalized(_requestId);

        // if we are assuming that:
        // 1) Discount history are rarely grows durung normal operation (see `_updateDiscountHistory`)
        // 2) Most users will claim their withdrawal as soon as possible after the finalization
        //
        // It's reasonable to check if the last discount is the right one before starting the search
        uint256 middle = lastDiscountIndex;
        int8 comparision = _compareWithHint(_requestId, middle);
        while (comparision != 0) {
            middle = (_firstIndex + _lastIndex) / 2;
            comparision = _compareWithHint(_requestId, middle);
            if (comparision > 0) _firstIndex = middle;
            if (comparision < 0) _lastIndex = middle;
        }
        return middle;
    }

    /**
     * @notice Claim `_requestId` request and transfer reserved ether to recipient
     * @param _requestId request id to claim
     * @param _hint rate index found offchain that should be used for claiming
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) public {
        if (_requestId == 0) revert ZeroRequestId();
        if (_requestId > lastFinalizedRequestId) revert RequestNotFinalized(_requestId);

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed();

        request.claimed = true;

        Discount memory discount;
        if (_hint <= lastDiscountIndex && _compareWithHint(_requestId, _hint) == 0) {
            discount = discountHistory[_hint];
        } else {
            revert InvalidHint(_hint);
        }

        uint128 ethToSend = queue[_requestId].cumulativeStETH - queue[_requestId - 1].cumulativeStETH;
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
        WithdrawalRequest memory lastRequest = queue[lastRequestId];

        uint256 cumulativeShares = lastRequest.cumulativeShares + _amountofShares;
        uint256 cumulativeStETH = lastRequest.cumulativeStETH + _amountOfStETH;

        lastRequestId++;
        requestId = lastRequestId;
        queue[requestId] = WithdrawalRequest(
            _toUint128(cumulativeStETH),
            _toUint128(cumulativeShares),
            payable(_recipient),
            _toUint64(block.number),
            false
        );
        requestsByRecipient[_recipient].push(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, _amountofShares);
    }

    /// @dev Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    function _finalize(uint256 _lastRequestIdToFinalize, uint256 _amountofETH) internal {
        if (_lastRequestIdToFinalize <= lastFinalizedRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);
        if (_lastRequestIdToFinalize > lastRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);

        uint128 finalizedStETH = queue[lastFinalizedRequestId].cumulativeStETH;
        uint128 stETHToFinalize = queue[_lastRequestIdToFinalize].cumulativeStETH - finalizedStETH;
        uint96 discountFactor = _calculateDiscountFactor(stETHToFinalize, _amountofETH);

        _updateDiscountHistory(_lastRequestIdToFinalize, discountFactor);

        lockedEtherAmount += _applyDiscount(stETHToFinalize, discountFactor);
        lastFinalizedRequestId = _lastRequestIdToFinalize;
    }

    /// @dev calculates the sum of stETH and shares for all requests in (`_firstId`, `_lastId`]
    function _batch(uint256 _firstId, uint256 _lastId)
        internal
        view
        returns (uint128 amountOfStETH, uint128 amountOfShares)
    {
        amountOfStETH = queue[_lastId].cumulativeStETH - queue[_firstId].cumulativeStETH;
        amountOfShares = queue[_lastId].cumulativeShares - queue[_firstId].cumulativeShares;
    }

    /// @dev returns discount factor for finalization
    function _calculateDiscountFactor(uint256 _requestedValue, uint256 _realValue) internal pure returns (uint96) {
        if (_requestedValue > _realValue) {
            return _toUint96(_realValue * E27_PRECISION_BASE / _requestedValue);
        }
        return NO_DISCOUNT;
    }

    /// @dev apply discount factor to the given amount of tokens
    function _applyDiscount(uint256 _amountOfStETH, uint96 _discountFactor) internal pure returns (uint128) {
        return _toUint128(_amountOfStETH * _discountFactor / E27_PRECISION_BASE);
    }

    /// @dev returns -1 if `requestId` is to the left from the hint range
    ///      returns  0 if `requestId` is inside the hint range
    ///      returns +1 if `requestId` is to the right of the hint range
    ///      where hint range is `(discountHistory[_hint - 1].indexInQueue, discountHistory[_hint].indexInQueue]`
    function _compareWithHint(uint256 _requestId, uint256 _hint) internal view returns (int8 result) {
        assert(_hint <= lastDiscountIndex);

        if (discountHistory[_hint].indexInQueue < _requestId) {
            return 1;
        }

        if (_hint > 0 && _requestId <= discountHistory[_hint - 1].indexInQueue) {
            return -1;
        }
    }

    /// @dev add a new entry to discount history or modify the last one if discount does not change
    function _updateDiscountHistory(uint256 _index, uint96 _discountFactor) internal {
        Discount storage lastDiscount = discountHistory[lastDiscountIndex];

        if (_discountFactor == lastDiscount.discountFactor) {
            lastDiscount.indexInQueue = _index;
        } else {
            lastDiscountIndex++;
            discountHistory[lastDiscountIndex] = Discount(_index, _discountFactor);
        }
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    function _toUint64(uint256 _value) internal pure returns (uint64) {
        if (_value > type(uint64).max) revert SafeCastValueDoesNotFit64Bits();
        return uint64(_value);
    }

    function _toUint96(uint256 _value) internal pure returns (uint96) {
        if (_value > type(uint96).max) revert SafeCastValueDoesNotFit96Bits();
        return uint96(_value);
    }

    function _toUint128(uint256 _value) internal pure returns (uint128) {
        if (_value > type(uint128).max) revert SafeCastValueDoesNotFit128Bits();
        return uint128(_value);
    }
}
