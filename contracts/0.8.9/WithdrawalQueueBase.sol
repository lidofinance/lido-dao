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
    uint256 public constant E27_PRECISION_BASE = 1e27;
    /// @notice discount factor value that means no discount applying
    uint96 public constant NO_DISCOUNT = uint96(E27_PRECISION_BASE);

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
        /// @notice first `_requestId` the discount is valid for
        uint256 fromId;
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

    error ZeroAmountOfETH();
    error ZeroShareRate();
    error ZeroTimestamp();
    error RecipientExpected(address _recipient, address _sender);
    error InvalidRecipient(address _recipient);
    error InvalidRequestId(uint256 _requestId);
    error InvalidRequestIdRange(uint256 startId, uint256 endId);
    error NotEnoughEther();
    error RequestNotFinalized(uint256 _requestId);
    error RequestAlreadyClaimed(uint256 _requestId);
    error InvalidHint(uint256 _hint);
    error CantSendValueRecipientMayHaveReverted();
    error SafeCastValueDoesNotFit(uint16 maximumBitSize);

    /// @notice queue for withdrawal requests, indexes (requestId) start from 1
    /// @dev mapping for better upgradability of underlying struct, because in the array structs are stored packed
    mapping(uint256 => WithdrawalRequest) internal queue;

    /// @notice length of the queue
    uint256 public lastRequestId = 0;

    /// @notice length of the finalized part of the queue. Always <= `requestCounter`
    uint256 public lastFinalizedRequestId = lastRequestId;

    /// @notice finalization discount history, indexes start from 1
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
        // 0-index is reserved as 'not_found' response in the interface everywhere
        queue[lastRequestId] = WithdrawalRequest(0, 0, payable(0), uint64(block.number), true);
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
        if (_requestId == 0) revert InvalidRequestId(_requestId);
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
     * @param _nextFinalizedRequestId the index in the request queue that should be used as the end of the batch. 
     *  Should be > 0
     * @param _shareRate share rate that will be used to calculate the batch value with 1e27 precision. Should be > 0
     *
     * @return ethToLock amount of ETH required to finalize the batch
     * @return sharesToBurn amount of shares that should be burned on finalization
     */
    function finalizationBatch(uint256 _nextFinalizedRequestId, uint256 _shareRate)
        public
        view
        returns (uint256 ethToLock, uint256 sharesToBurn)
    {
        if (_shareRate == 0) revert ZeroShareRate();
        if (_nextFinalizedRequestId <= lastFinalizedRequestId) revert InvalidRequestId(_nextFinalizedRequestId);
        if (_nextFinalizedRequestId > lastRequestId) revert InvalidRequestId(_nextFinalizedRequestId);

        WithdrawalRequest memory requestToFinalize = queue[_nextFinalizedRequestId];
        WithdrawalRequest memory lastFinalizedRequest = queue[lastFinalizedRequestId];

        uint256 amountOfStETH = requestToFinalize.cumulativeStETH - lastFinalizedRequest.cumulativeStETH; //e18
        uint256 amountOfShares = requestToFinalize.cumulativeShares - lastFinalizedRequest.cumulativeShares; //e18

        uint256 currentValue = (amountOfShares * _shareRate); //e45
        
        uint256 discountFactor = NO_DISCOUNT;
        if (currentValue < amountOfStETH * E27_PRECISION_BASE) { //e45
            discountFactor = currentValue  / amountOfStETH; //e27
        }

        uint256 amountOfEther = (amountOfStETH * discountFactor) / E27_PRECISION_BASE;

        return (amountOfEther, amountOfShares);
    }

    /**
     * @notice View function to find a hint to pass it to `claimWithdrawal()`.
     * @dev WARNING! OOG is possible if used onchain, contains unbounded loop inside
     * See `findClaimHint(uint256 _requestId, uint256 _firstIndex, uint256 _lastIndex)` for onchain use
     * @param _requestId request id to be claimed with this hint
     */
    function findClaimHintUnbounded(uint256 _requestId) public view returns (uint256) {
        return findClaimHint(_requestId, 1, lastCheckpointIndex);
    }

    /**
     * @notice View function to find a hint for `claimWithdrawal()` in the range of `[_firstIndex, _lastIndex]`
     * @param _targetId request id to be claimed later
     * @param _start index of the left boundary of the search range
     * @param _end index of the right boundary of the search range
     *
     * @return the hint that can be used for `claimWithdrawal` to find the discount for the request, 
     *  or 0 if hint not found in the range
     */
    function findClaimHint(uint256 _targetId, uint256 _start, uint256 _end) public view returns (uint256) {
        if (_targetId == 0) revert InvalidRequestId(_targetId);
        if (_start == 0) revert InvalidRequestIdRange(_start, _end);
        if (_start > _end) revert InvalidRequestIdRange(_start, _end);
        if (_end > lastCheckpointIndex) revert InvalidRequestIdRange(_start, _end);
        if (_targetId > lastFinalizedRequestId) revert RequestNotFinalized(_targetId);

        // Right boundary
        if (_targetId >= checkpoints[_end].fromId) {
            // it's the last checkpoint, so it's valid
            if (_end == lastCheckpointIndex) return _end;
            // it fits right before the next checkpoint
            if (_targetId < checkpoints[_end + 1].fromId) return _end;

            return 0;
        }
        // Left boundary
        if (_targetId < checkpoints[_start].fromId) {
            return 0;
        }

        // Binary search 
        uint256 min = _start;
        uint256 max = _end;

        while (max > min) {
            uint256 mid = (max + min + 1) / 2;
            if (checkpoints[mid].fromId <= _targetId) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @notice Claim `_requestId` request and transfer locked ether to recipient
     * @param _requestId request id to claim
     * @param _hint hint for checkpoint index to avoid extensive search over the checkpointHistory.
     *  Can be found with `findClaimHint()` or `findClaimHintUnbounded()`
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) public {
        if (_hint == 0) revert InvalidHint(_hint);
        if (_requestId > lastFinalizedRequestId) revert RequestNotFinalized(_requestId);
        if (_hint > lastCheckpointIndex) revert InvalidHint(_hint);

        WithdrawalRequest storage request = queue[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        request.claimed = true;

        DiscountCheckpoint memory hintCheckpoint = checkpoints[_hint];
        // ______(_______
        //    ^  hint
        if (_requestId < hintCheckpoint.fromId) revert InvalidHint(_hint);
        if (_hint + 1 <= lastCheckpointIndex) {
            // ______(_______(_________
            //       hint    hint+1  ^
            if (checkpoints[_hint + 1].fromId <= _hint) {
                revert InvalidHint(_hint);
            }
        }

        uint256 ethRequested = request.cumulativeStETH - queue[_requestId - 1].cumulativeStETH;
        uint256 ethWithDiscount = ethRequested * hintCheckpoint.discountFactor / E27_PRECISION_BASE;

        lockedEtherAmount -= uint128(ethWithDiscount);

        _sendValue(request.recipient, ethWithDiscount);

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
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        request.recipient = payable(_newRecipient);

        requestsByRecipient[_newRecipient].add(_requestId);
        requestsByRecipient[msg.sender].remove(_requestId);

        emit WithdrawalRequestRecipientChanged(_requestId, _newRecipient, msg.sender);
    }

    /**
     * @notice Search for the latest request in the queue in the range of `[startId, endId]`,
     *  that fullfills a constraint `request.timestamp <= maxTimestamp`
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
     * @notice Search for the latest request in the queue in the range of `[startId, endId]`,
     *  that can be finalized within the given `_ethBudget` by `_shareRate`
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
        finalizableRequestId =
            findLastFinalizableRequestIdByBudget(_ethBudget, _shareRate, lastFinalizedRequestId + 1, lastRequestId);
        return findLastFinalizableRequestIdByTimestamp(_maxTimestamp, lastFinalizedRequestId + 1, finalizableRequestId);
    }

    /// @dev creates a new `WithdrawalRequest` in the queue
    function _enqueue(uint128 _amountOfStETH, uint128 _amountofShares, address _recipient)
        internal
        returns (uint256 requestId)
    {
        WithdrawalRequest memory lastRequest = queue[lastRequestId];

        uint128 cumulativeShares = lastRequest.cumulativeShares + _amountofShares;
        uint128 cumulativeStETH = lastRequest.cumulativeStETH + _amountOfStETH;

        lastRequestId++;
        requestId = lastRequestId;
        queue[requestId] = WithdrawalRequest(
            cumulativeStETH,
            cumulativeShares,
            payable(_recipient),
            uint64(block.number),
            false
        );
        requestsByRecipient[_recipient].add(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _recipient, _amountOfStETH, _amountofShares);
    }

    /// @dev Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    function _finalize(uint256 _lastRequestIdToFinalize, uint128 _amountofETH) internal {
        if (_lastRequestIdToFinalize <= lastFinalizedRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);
        if (_lastRequestIdToFinalize > lastRequestId) revert InvalidRequestId(_lastRequestIdToFinalize);

        uint128 finalizedStETH = queue[lastFinalizedRequestId].cumulativeStETH;
        uint128 stETHToFinalize = queue[_lastRequestIdToFinalize].cumulativeStETH - finalizedStETH;

        uint256 discountFactor = NO_DISCOUNT;
        if (stETHToFinalize > _amountofETH) {
            discountFactor = _amountofETH * E27_PRECISION_BASE / stETHToFinalize;
        }

        DiscountCheckpoint storage lastCheckpoint = checkpoints[lastCheckpointIndex];

        if (discountFactor != lastCheckpoint.discountFactor) {
            // add a new discount if it differs from the previous
            lastCheckpointIndex++;
            checkpoints[lastCheckpointIndex] = DiscountCheckpoint(lastFinalizedRequestId + 1, uint96(discountFactor));
        }

        lockedEtherAmount += _amountofETH;
        lastFinalizedRequestId = _lastRequestIdToFinalize;
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }
}
