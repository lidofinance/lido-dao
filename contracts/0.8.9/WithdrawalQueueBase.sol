// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";

/**
 * @title Queue to store and manage WithdrawalRequests. 
 * @dev Use an optimizations to store discounts heavily inpsired 
 * by Aragon MiniMe token https://github.com/aragon/aragon-minime/blob/master/contracts/MiniMeToken.sol
 *
 * @author folkyatina
 */
abstract contract WithdrawalQueueBase {
    using EnumerableSet for EnumerableSet.UintSet;

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
        /// @notice block.timestamp when the request was created
        uint64 timestamp;
        /// @notice flag if the request was claimed
        bool claimed;
    }

    /// @notice structure to store discount factors for requests in the queue
    struct DiscountCheckpoint {
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
    event WithdrawalRequestRecipientChanged(uint256 indexed requestId, address newRecipient, address oldRecipient);

    error ZeroRecipientAddress();
    error ZeroRequestId();
    error ZeroAmountOfETH();
    error ZeroShareRate();
    error ZeroTimestamp();
    error SenderExpected(address _recipient, address _msgSender);
    error RecipientExpected(address _recipient, address _msgSender);
    error InvalidRecipient(address _recipient);
    error InvalidRequestId(uint256 _requestId);
    error InvalidRequestIdRange(uint256 startId, uint256 endId);
    error NotEnoughEther();
    error RequestNotFinalized(uint256 _requestId);
    error RequestAlreadyClaimed();
    error InvalidHint(uint256 _hint);
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit(uint16 maximumBitSize);

    /// @notice queue for withdrawal requests
    /// @dev mapping for better upgradability of underlying struct, because in the array structs are stored packed
    mapping(uint256 => WithdrawalRequest) internal queue;

    /// @notice length of the queue
    uint256 public lastRequestId = 0;

    /// @notice length of the finalized part of the queue. Always <= `requestCounter`
    uint256 public lastFinalizedRequestId = lastRequestId;

    /// @notice finalization discount history
    /// @dev mapping for better upgradability of underlying struct, because in the array structs are stored packed
    mapping(uint256 => DiscountCheckpoint) internal checkpoints;

    /// @notice size of checkpoins array
    uint256 public lastCheckpointIndex = 0;

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
    uint128 public lockedEtherAmount = 0;

    /// @notice withdrawal requests mapped to the recipients
    mapping(address => EnumerableSet.UintSet) private requestsByRecipient;

    function _initializeQueue() internal {
        // setting dummy zero structs in checkpoints and queue beginning
        // to avoid uint underflows and related if-branches
        queue[lastRequestId] = WithdrawalRequest(0, 0, payable(0), _toUint64(block.number), true);
        checkpoints[lastCheckpointIndex] = DiscountCheckpoint(lastRequestId, 0);
    }

    /// @notice return the number of unfinalized requests in the queue
    function unfinalizedRequestNumber() external view returns (uint256) {
        return lastRequestId - lastFinalizedRequestId;
    }

    /// @notice Returns the amount of stETH yet to be finalized
    function unfinalizedStETH() external view returns (uint256) {
        return queue[lastRequestId].cumulativeStETH - queue[lastFinalizedRequestId].cumulativeStETH;
    }

    /**
     * @notice Returns all withdrawal requests placed for the `_recipient` address
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function getWithdrawalRequests(address _recipient) external view returns (uint256[] memory requestsIds) {
        return requestsByRecipient[_recipient].values();
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
            uint256 timestamp,
            bool isFinalized,
            bool isClaimed
        )
    {
        if (_requestId == 0) revert ZeroRequestId();
        if (_requestId > lastRequestId) revert InvalidRequestId(_requestId);

        WithdrawalRequest memory request = queue[_requestId];
        WithdrawalRequest memory previousRequest = queue[_requestId - 1];

        recipient = request.recipient;
        timestamp = request.timestamp;

        amountOfShares = request.cumulativeShares - previousRequest.cumulativeShares;
        amountOfStETH = request.cumulativeStETH - previousRequest.cumulativeStETH;

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
        public
        view
        returns (uint128 eth, uint128 shares)
    {
        if (_shareRate == 0) revert ZeroShareRate();
        if (_lastRequestIdToFinalize <= lastFinalizedRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);
        if (_lastRequestIdToFinalize > lastRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);

        (eth, shares) = _batch(lastFinalizedRequestId, _lastRequestIdToFinalize);
        uint256 batchValue = shares * _shareRate / E27_PRECISION_BASE;
        uint96 discountFactor = _calculateDiscountFactor(eth, batchValue);
        eth = _applyDiscount(eth, discountFactor);
    }

    /**
     * @notice View function to find a hint to pass it to `claimWithdrawal()`.
     * @dev WARNING! OOG is possible if used onchain, contains unbounded loop inside
     * See `findClaimHint(uint256 _requestId, uint256 _firstIndex, uint256 _lastIndex)` for onchain use
     * @param _requestId request id to be claimed with this hint
     */
    function findClaimHintUnbounded(uint256 _requestId) public view returns (uint256) {
        return findClaimHint(_requestId, 0, lastCheckpointIndex);
    }

    /**
     * @notice View function to find a hint for `claimWithdrawal()` in the range of `[_firstIndex, _lastIndex]`
     * @param _requestId request id to be claimed later
     * @param _firstIndex left boundary of the search range
     * @param _lastIndex right boundary of the search range
     *
     * @return the hint for `claimWithdrawal` to find the discount for the request, or zero if hint not found
     */
    function findClaimHint(uint256 _requestId, uint256 _firstIndex, uint256 _lastIndex)
        public
        view
        returns (uint256)
    {
        if (_requestId > lastFinalizedRequestId) revert RequestNotFinalized(_requestId);

        uint256 midCheckpointIndex = _lastIndex;
        int8 comparisionResult = _compareWithHint(_requestId, midCheckpointIndex);

        while (comparisionResult != 0 && _firstIndex < _lastIndex) {
            midCheckpointIndex = (_firstIndex + _lastIndex) / 2;
            comparisionResult = _compareWithHint(_requestId, midCheckpointIndex);
            if (comparisionResult > 0) _firstIndex = midCheckpointIndex + 1;
            if (comparisionResult < 0) _lastIndex = midCheckpointIndex;
        }

        return comparisionResult == 0 ? midCheckpointIndex : 0;
    }

    /**
     * @notice Claim `_requestId` request and transfer locked ether to recipient
     * @param _requestId request id to claim
     * @param _hint hint for checkpoint index to avoid extensive search over the checkpointHistory.
     *  Can be found with `findClaimHint()` or `findClaimHintUnbounded()`
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) public {
        if (_requestId > lastFinalizedRequestId) revert RequestNotFinalized(_requestId);

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed();

        request.claimed = true;

        DiscountCheckpoint memory checkpoint;
        if (_hint <= lastCheckpointIndex && _compareWithHint(_requestId, _hint) == 0) {
            checkpoint = checkpoints[_hint];
        } else {
            revert InvalidHint(_hint);
        }

        uint128 ethToSend = queue[_requestId].cumulativeStETH - queue[_requestId - 1].cumulativeStETH;
        ethToSend = _applyDiscount(ethToSend, checkpoint.discountFactor);

        lockedEtherAmount -= ethToSend;

        _sendValue(request.recipient, ethToSend);

        emit WithdrawalClaimed(_requestId, request.recipient, msg.sender);
    }

    /**
     * @notice Transfer the right to claim withdrawal to another `_newRecipient`
     * @dev should be called by the old recepient
     * @param _requestId id of the request subject to change
     * @param _newRecipient new recipient address for withdrawal
     */
    function changeRecipient(uint256 _requestId, address _newRecipient) external {
        if (_newRecipient == msg.sender) revert InvalidRecipient(_newRecipient);
        if (_requestId > lastRequestId) revert InvalidRequestId(_requestId);

        WithdrawalRequest storage request = queue[_requestId];

        if (request.recipient != msg.sender) revert RecipientExpected(request.recipient, msg.sender);
        if (request.claimed) revert RequestAlreadyClaimed();

        request.recipient = payable(_newRecipient);

        requestsByRecipient[_newRecipient].add(_requestId);
        requestsByRecipient[msg.sender].remove(_requestId);

        emit WithdrawalRequestRecipientChanged(_requestId, _newRecipient, msg.sender);
    }

    /**
     * @notice Search for the latest request in `[startId, endId]` that has a timestamp <= `maxTimestamp`
     *
     * @return finalizableRequestId requested id or 0, if there are no requests in a range with requested timestamp
     */
    function findLastFinalizableRequestIdByTimestamp(uint256 _maxTimestamp, uint256 _startId, uint256 _endId)
        public
        view
        returns (uint256 finalizableRequestId)
    {
        if (_maxTimestamp == 0) revert ZeroTimestamp();
        if (_startId <= lastFinalizedRequestId) revert InvalidRequestIdRange(_startId, _endId);
        if (_endId > lastRequestId) revert InvalidRequestIdRange(_startId, _endId);

        if (_startId > _endId) return 0; // we have an empty range to search in

        uint256 startRequestId = _startId;
        uint256 endRequestId = _endId;

        finalizableRequestId = 0;

        while (startRequestId <= endRequestId) {
            uint256 midRequestId = (endRequestId + startRequestId) / 2;
            if (queue[midRequestId].timestamp <= _maxTimestamp) {
                finalizableRequestId = midRequestId;

                // Ignore left half
                startRequestId = midRequestId + 1;
            } else {
                // Ignore right half
                endRequestId = midRequestId - 1;
            }
        }
    }

    /**
     * @notice Search for the latest request in `[startId, endId]` that can be finalized within the given `ethBudget`
     * @param _ethBudget amount of ether available for withdrawal fullfilment
     * @param _shareRate share/ETH rate that will be used for fullfilment
     * @param _startId requestId to start search from. Should be > lastFinalizedRequestId
     * @param _endId requestId to search upon to. Should be <= lastRequestId
     * 
     * @return finalizableRequestId requested id or 0, if there are no requests finalizable within the given `_ethBudget`
     */
    function findLastFinalizableRequestIdByBudget(
        uint256 _ethBudget,
        uint256 _shareRate,
        uint256 _startId,
        uint256 _endId
    ) public view returns (uint256 finalizableRequestId) {
        if (_ethBudget == 0) revert ZeroAmountOfETH();
        if (_shareRate == 0) revert ZeroShareRate();
        if (_startId <= lastFinalizedRequestId) revert InvalidRequestIdRange(_startId, _endId);
        if (_endId > lastRequestId) revert InvalidRequestIdRange(_startId, _endId);

        if (_startId > _endId) return 0; // we have an empty range to search in

        uint256 startRequestId = _startId;
        uint256 endRequestId = _endId;

        finalizableRequestId = 0;

        while (startRequestId <= endRequestId) {
            uint256 midRequestId = (endRequestId + startRequestId) / 2;
            (uint256 requiredEth,) = finalizationBatch(midRequestId, _shareRate);

            if (requiredEth <= _ethBudget) {
                finalizableRequestId = midRequestId;

                // Ignore left half
                startRequestId = midRequestId + 1;
            } else {
                // Ignore right half
                endRequestId = midRequestId - 1;
            }
        }
    }

    /**
     * @notice Returns last requestId, that is finalizable 
     *  - within `_ethBudget`
     *  - using  `_shareRate`
     *  - created earlier than `_maxTimestamp`
     * @dev WARNING! OOG is possible if used onchain, contains unbounded loop inside
     */
    function findLastFinalizableRequestId(uint256 _ethBudget, uint256 _shareRate, uint256 _maxTimestamp)
        public
        view
        returns (uint256 finalizableRequestId)
    {
        finalizableRequestId = findLastFinalizableRequestIdByBudget(_ethBudget, _shareRate, lastFinalizedRequestId + 1, lastRequestId);
        return findLastFinalizableRequestIdByTimestamp(_maxTimestamp, lastFinalizedRequestId + 1, finalizableRequestId);
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
        requestsByRecipient[_recipient].add(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, _amountofShares);
    }

    /// @dev Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    function _finalize(uint256 _lastRequestIdToFinalize, uint256 _amountofETH) internal {
        if (_lastRequestIdToFinalize <= lastFinalizedRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);
        if (_lastRequestIdToFinalize > lastRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);

        uint128 finalizedStETH = queue[lastFinalizedRequestId].cumulativeStETH;
        uint128 stETHToFinalize = queue[_lastRequestIdToFinalize].cumulativeStETH - finalizedStETH;
        uint96 discountFactor = _calculateDiscountFactor(stETHToFinalize, _amountofETH);

        _updateCheckpoints(_lastRequestIdToFinalize, discountFactor);

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
    ///      where hint range is `(checkpoints[_hint - 1].indexInQueue, checkpoints[_hint].indexInQueue]`
    function _compareWithHint(uint256 _requestId, uint256 _hint) internal view returns (int8 result) {
        assert(_hint <= lastCheckpointIndex);

        if (checkpoints[_hint].indexInQueue < _requestId) {
            return 1;
        }

        if (_hint > 0 && _requestId <= checkpoints[_hint - 1].indexInQueue) {
            return -1;
        }
    }

    /// @dev add a new entry to discount history or modify the last one if discount does not change
    function _updateCheckpoints(uint256 _index, uint96 _discountFactor) internal {
        DiscountCheckpoint storage lastCheckpoint = checkpoints[lastCheckpointIndex];

        if (_discountFactor == lastCheckpoint.discountFactor) {
            lastCheckpoint.indexInQueue = _index;
        } else {
            lastCheckpointIndex++;
            checkpoints[lastCheckpointIndex] = DiscountCheckpoint(_index, _discountFactor);
        }
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    function _toUint64(uint256 _value) internal pure returns (uint64) {
        if (_value > type(uint64).max) revert SafeCastValueDoesNotFit(64);
        return uint64(_value);
    }

    function _toUint96(uint256 _value) internal pure returns (uint96) {
        if (_value > type(uint96).max) revert SafeCastValueDoesNotFit(96);
        return uint96(_value);
    }

    function _toUint128(uint256 _value) internal pure returns (uint128) {
        if (_value > type(uint128).max) revert SafeCastValueDoesNotFit(128);
        return uint128(_value);
    }
}
