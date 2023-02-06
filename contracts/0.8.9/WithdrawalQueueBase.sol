// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {UnstructuredRefStorage} from "./lib/UnstructuredRefStorage.sol";

/**
 * @title Queue to store and manage WithdrawalRequests.
 * @dev Use an optimizations to store discounts heavily inspired
 * by Aragon MiniMe token https://github.com/aragon/aragon-minime/blob/master/contracts/MiniMeToken.sol
 *
 * @author folkyatina
 */
abstract contract WithdrawalQueueBase {
    using EnumerableSet for EnumerableSet.UintSet;
    using UnstructuredStorage for bytes32;

    /// @notice precision base for share rate and discounting factor values in the contract
    uint256 public constant E27_PRECISION_BASE = 1e27;

    /// @notice discount factor value that means no discount applying
    uint96 internal constant NO_DISCOUNT = uint96(E27_PRECISION_BASE);

    // queue for withdrawal requests, indexes (requestId) start from 1
    bytes32 internal constant QUEUE_POSITION = keccak256("lido.WithdrawalQueue.queue");
    // length of the queue
    bytes32 internal constant LAST_REQUEST_ID_POSITION = keccak256("lido.WithdrawalQueue.lastRequestId");
    // length of the finalized part of the queue. Always <= `requestCounter`
    bytes32 internal constant LAST_FINALIZED_REQUEST_ID_POSITION =
        keccak256("lido.WithdrawalQueue.lastFinalizedRequestId");
    /// finalization discount history, indexes start from 1
    bytes32 internal constant CHECKPOINTS_POSITION = keccak256("lido.WithdrawalQueue.checkpoints");
    /// length of the checkpoints
    bytes32 internal constant LAST_CHECKPOINT_INDEX_POSITION = keccak256("lido.WithdrawalQueue.lastCheckpointIndex");
    /// amount of eth locked on contract for withdrawal
    bytes32 internal constant LOCKED_ETHER_AMOUNT_POSITION = keccak256("lido.WithdrawalQueue.lockedEtherAmount");
    /// withdrawal requests mapped to the owners
    bytes32 internal constant REQUEST_BY_OWNER_POSITION = keccak256("lido.WithdrawalQueue.requestsByOwner");

    /// @notice structure representing a request for withdrawal.
    struct WithdrawalRequest {
        /// @notice sum of the all stETH submitted for withdrawals up to this request
        uint128 cumulativeStETH;
        /// @notice sum of the all shares locked for withdrawal up to this request
        uint128 cumulativeShares;
        /// @notice address that can claim or transfer the request
        address payable owner;
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

    /// @dev Contains both stETH token amount and its corresponding shares amount
    event WithdrawalRequested(
        uint256 indexed requestId,
        address indexed requestor,
        address indexed owner,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );
    event WithdrawalBatchFinalized(
        uint256 indexed from, uint256 indexed to, uint256 amountOfETHLocked, uint256 sharesBurned, uint256 timestamp
    );
    event WithdrawalClaimed(
        uint256 indexed requestId, address indexed receiver, address initiator, uint256 amountOfETH
    );
    event WithdrawalRequestTransferred(uint256 indexed requestId, address newOwner, address oldOwner);

    error ZeroAmountOfETH();
    error ZeroShareRate();
    error ZeroTimestamp();
    error InvalidOwner(address _owner, address _sender);
    error InvalidOwnerAddress(address _owner);
    error InvalidRequestId(uint256 _requestId);
    error InvalidRequestIdRange(uint256 startId, uint256 endId);
    error NotEnoughEther();
    error RequestNotFinalized(uint256 _requestId);
    error RequestAlreadyClaimed(uint256 _requestId);
    error InvalidHint(uint256 _hint);
    error CantSendValueRecipientMayHaveReverted();

    /// @notice id of the last request. Equals to the length of the queue
    function getLastRequestId() public view returns (uint256) {
        return LAST_REQUEST_ID_POSITION.getStorageUint256();
    }

    /// @notice id of the last finalized request
    function getLastFinalizedRequestId() public view returns (uint256) {
        return LAST_FINALIZED_REQUEST_ID_POSITION.getStorageUint256();
    }

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and waiting for claim
    function getLockedEtherAmount() public view returns (uint256) {
        return LOCKED_ETHER_AMOUNT_POSITION.getStorageUint256();
    }

    /// @notice length of the checkpoints. Last possible value for the claim hint
    function getLastCheckpointIndex() public view returns (uint256) {
        return LAST_CHECKPOINT_INDEX_POSITION.getStorageUint256();
    }

    /// @notice return the number of unfinalized requests in the queue
    function unfinalizedRequestNumber() external view returns (uint256) {
        return getLastRequestId() - getLastFinalizedRequestId();
    }

    /// @notice Returns the amount of stETH yet to be finalized
    function unfinalizedStETH() external view returns (uint256) {
        return
            _getQueue()[getLastRequestId()].cumulativeStETH - _getQueue()[getLastFinalizedRequestId()].cumulativeStETH;
    }

    /**
     * @notice Returns all withdrawal requests placed for the `_owner` address
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function getWithdrawalRequests(address _owner) external view returns (uint256[] memory requestsIds) {
        return _getRequestByOwner()[_owner].values();
    }

    struct WithdrawalRequestStatus {
        /// @notice stETH token amount that was locked on withdrawal queue for this request
        uint256 amountOfStETH;
        /// @notice amount of stETH shares locked on withdrawal queue for this request
        uint256 amountOfShares;
        /// @notice address that can claim or transfer this request
        address owner;
        /// @notice timestamp of when the request was created, in seconds
        uint256 timestamp;
        /// @notice true, if request is finalized
        bool isFinalized;
        /// @notice true, if request is already claimed. Request can be claimed if (isFinalized && !isClaimed)
        bool isClaimed;
    }

    /**
     * @notice Returns status of the withdrawal request
     */
    function getWithdrawalRequestStatus(uint256 _requestId)
        public
        view
        returns (WithdrawalRequestStatus memory status)
    {
        if (_requestId == 0) revert InvalidRequestId(_requestId);
        if (_requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

        WithdrawalRequest memory request = _getQueue()[_requestId];
        WithdrawalRequest memory previousRequest = _getQueue()[_requestId - 1];

        status = WithdrawalRequestStatus(
            request.cumulativeStETH - previousRequest.cumulativeStETH,
            request.cumulativeShares - previousRequest.cumulativeShares,
            request.owner,
            request.timestamp,
            _requestId <= getLastFinalizedRequestId(),
            request.claimed
        );
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
        if (_nextFinalizedRequestId > getLastRequestId()) revert InvalidRequestId(_nextFinalizedRequestId);
        uint256 lastFinalizedRequestId = getLastFinalizedRequestId();
        if (_nextFinalizedRequestId <= lastFinalizedRequestId) revert InvalidRequestId(_nextFinalizedRequestId);

        WithdrawalRequest memory requestToFinalize = _getQueue()[_nextFinalizedRequestId];
        WithdrawalRequest memory lastFinalizedRequest = _getQueue()[lastFinalizedRequestId];

        uint256 amountOfStETH = requestToFinalize.cumulativeStETH - lastFinalizedRequest.cumulativeStETH; //e18
        uint256 amountOfShares = requestToFinalize.cumulativeShares - lastFinalizedRequest.cumulativeShares; //e18

        uint256 currentValue = (amountOfShares * _shareRate); //e45

        uint256 discountFactor = NO_DISCOUNT;
        if (currentValue < amountOfStETH * E27_PRECISION_BASE) {
            //e45
            discountFactor = currentValue / amountOfStETH; //e27
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
        return findClaimHint(_requestId, 1, getLastCheckpointIndex());
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
        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        if (_end > lastCheckpointIndex) revert InvalidRequestIdRange(_start, _end);
        if (_targetId > getLastFinalizedRequestId()) revert RequestNotFinalized(_targetId);

        // Right boundary
        if (_targetId >= _getCheckpoints()[_end].fromId) {
            // it's the last checkpoint, so it's valid
            if (_end == lastCheckpointIndex) return _end;
            // it fits right before the next checkpoint
            if (_targetId < _getCheckpoints()[_end + 1].fromId) return _end;

            return 0;
        }
        // Left boundary
        if (_targetId < _getCheckpoints()[_start].fromId) {
            return 0;
        }

        // Binary search
        uint256 min = _start;
        uint256 max = _end;

        while (max > min) {
            uint256 mid = (max + min + 1) / 2;
            if (_getCheckpoints()[mid].fromId <= _targetId) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @notice Claim `_requestId` request and transfer locked ether to the owner
     * @param _requestId request id to claim
     * @param _hint hint for checkpoint index to avoid extensive search over the checkpointHistory.
     *  Can be found with `findClaimHint()` or `findClaimHintUnbounded()`
     */
    function claimWithdrawal(uint256 _requestId, uint256 _hint) public {
        if (_hint == 0) revert InvalidHint(_hint);
        if (_requestId > getLastFinalizedRequestId()) revert RequestNotFinalized(_requestId);
        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        if (_hint > lastCheckpointIndex) revert InvalidHint(_hint);

        WithdrawalRequest storage request = _getQueue()[_requestId];
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        request.claimed = true;

        DiscountCheckpoint memory hintCheckpoint = _getCheckpoints()[_hint];
        // ______(_______
        //    ^  hint
        if (_requestId < hintCheckpoint.fromId) revert InvalidHint(_hint);
        if (_hint + 1 <= lastCheckpointIndex) {
            // ______(_______(_________
            //       hint    hint+1  ^
            if (_getCheckpoints()[_hint + 1].fromId <= _hint) {
                revert InvalidHint(_hint);
            }
        }

        uint256 ethRequested = request.cumulativeStETH - _getQueue()[_requestId - 1].cumulativeStETH;
        uint256 ethWithDiscount = ethRequested * hintCheckpoint.discountFactor / E27_PRECISION_BASE;

        _setLockedEtherAmount(getLockedEtherAmount() - ethWithDiscount);

        _sendValue(request.owner, ethWithDiscount);

        emit WithdrawalClaimed(_requestId, request.owner, msg.sender, ethWithDiscount);
    }

    /**
     * @notice Claim `_requestId` request and transfer locked ether to the owner
     * @param _requestId request id to claim
     * @dev will use `findClaimHintUnbounded()` to find a hint, what can lead to OOG
     * Prefer `claimWithdrawal(uint256 _requestId, uint256 _hint)` to save gas
     */
    function claimWithdrawal(uint256 _requestId) external {
        claimWithdrawal(_requestId, findClaimHintUnbounded(_requestId));
    }

    /**
     * @notice Transfer the right to claim withdrawal request to `_newRecipient`
     * @dev should be called by the old recipient
     * @param _requestId id of the request subject to change
     * @param _newOwner new owner address for withdrawal request
     */
    function transfer(uint256 _requestId, address _newOwner) external {
        if (_newOwner == address(0)) revert InvalidOwnerAddress(_newOwner);
        if (_newOwner == msg.sender) revert InvalidOwnerAddress(_newOwner);
        if (_requestId == 0) revert InvalidRequestId(_requestId);
        if (_requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

        WithdrawalRequest storage request = _getQueue()[_requestId];

        if (request.owner != msg.sender) revert InvalidOwner(request.owner, msg.sender);
        if (request.claimed) revert RequestAlreadyClaimed(_requestId);

        request.owner = payable(_newOwner);

        _getRequestByOwner()[_newOwner].add(_requestId);
        _getRequestByOwner()[msg.sender].remove(_requestId);

        emit WithdrawalRequestTransferred(_requestId, _newOwner, msg.sender);
    }

    /**
     * @notice Search for the latest request in the queue in the range of `[startId, endId]`,
     *  that fulfills a constraint `request.timestamp <= maxTimestamp`
     *
     * @return finalizableRequestId requested id or 0, if there are no requests in a range with requested timestamp
     */
    function findLastFinalizableRequestIdByTimestamp(uint256 _maxTimestamp, uint256 _startId, uint256 _endId)
        public
        view
        returns (uint256 finalizableRequestId)
    {
        if (_maxTimestamp == 0) revert ZeroTimestamp();
        if (_startId <= getLastFinalizedRequestId()) revert InvalidRequestIdRange(_startId, _endId);
        if (_endId > getLastRequestId()) revert InvalidRequestIdRange(_startId, _endId);

        if (_startId > _endId) return 0; // we have an empty range to search in

        uint256 startRequestId = _startId;
        uint256 endRequestId = _endId;

        finalizableRequestId = 0;

        while (startRequestId <= endRequestId) {
            uint256 midRequestId = (endRequestId + startRequestId) / 2;
            if (_getQueue()[midRequestId].timestamp <= _maxTimestamp) {
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
     * @param _ethBudget amount of ether available for withdrawal fulfillment
     * @param _shareRate share/ETH rate that will be used for fulfillment
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
        if (_startId <= getLastFinalizedRequestId()) revert InvalidRequestIdRange(_startId, _endId);
        if (_endId > getLastRequestId()) revert InvalidRequestIdRange(_startId, _endId);

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
        uint256 firstUnfinalizedRequestId = getLastFinalizedRequestId() + 1;
        finalizableRequestId =
            findLastFinalizableRequestIdByBudget(_ethBudget, _shareRate, firstUnfinalizedRequestId, getLastRequestId());
        return findLastFinalizableRequestIdByTimestamp(_maxTimestamp, firstUnfinalizedRequestId, finalizableRequestId);
    }

    /// @dev creates a new `WithdrawalRequest` in the queue
    function _enqueue(uint128 _amountOfStETH, uint128 _amountOfShares, address _owner)
        internal
        returns (uint256 requestId)
    {
        uint256 lastRequestId = getLastRequestId();
        WithdrawalRequest memory lastRequest = _getQueue()[lastRequestId];

        uint128 cumulativeShares = lastRequest.cumulativeShares + _amountOfShares;
        uint128 cumulativeStETH = lastRequest.cumulativeStETH + _amountOfStETH;

        requestId = lastRequestId + 1;

        _setLastRequestId(requestId);
        _getQueue()[requestId] =
            WithdrawalRequest(cumulativeStETH, cumulativeShares, payable(_owner), uint64(block.number), false);
        _getRequestByOwner()[_owner].add(requestId);

        emit WithdrawalRequested(requestId, msg.sender, _owner, _amountOfStETH, _amountOfShares);
    }

    /// @dev Finalize requests from last finalized one up to `_lastRequestIdToFinalize`
    function _finalize(uint256 _nextFinalizedRequestId, uint128 _amountOfETH) internal {
        if (_nextFinalizedRequestId > getLastRequestId()) revert InvalidRequestId(_nextFinalizedRequestId);
        uint256 lastFinalizedRequestId = getLastFinalizedRequestId();
        uint256 firstUnfinalizedRequestId = lastFinalizedRequestId + 1;
        if (_nextFinalizedRequestId <= lastFinalizedRequestId) revert InvalidRequestId(_nextFinalizedRequestId);

        WithdrawalRequest memory lastFinalizedRequest = _getQueue()[lastFinalizedRequestId];
        WithdrawalRequest memory requestToFinalize = _getQueue()[_nextFinalizedRequestId];

        uint128 stETHToFinalize = requestToFinalize.cumulativeStETH - lastFinalizedRequest.cumulativeStETH;

        uint256 discountFactor = NO_DISCOUNT;
        if (stETHToFinalize > _amountOfETH) {
            discountFactor = _amountOfETH * E27_PRECISION_BASE / stETHToFinalize;
        }

        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        DiscountCheckpoint storage lastCheckpoint = _getCheckpoints()[lastCheckpointIndex];

        if (discountFactor != lastCheckpoint.discountFactor) {
            // add a new discount if it differs from the previous
            _getCheckpoints()[lastCheckpointIndex + 1] =
                DiscountCheckpoint(firstUnfinalizedRequestId, uint96(discountFactor));
            _setLastCheckpointIndex(lastCheckpointIndex + 1);
        }

        _setLockedEtherAmount(getLockedEtherAmount() + _amountOfETH);
        _setLastFinalizedRequestId(_nextFinalizedRequestId);

        emit WithdrawalBatchFinalized(
            firstUnfinalizedRequestId,
            _nextFinalizedRequestId,
            _amountOfETH,
            requestToFinalize.cumulativeShares - lastFinalizedRequest.cumulativeShares,
            block.timestamp
            );
    }

    // quazi-constructor
    function _initializeQueue() internal {
        // setting dummy zero structs in checkpoints and queue beginning
        // to avoid uint underflows and related if-branches
        // 0-index is reserved as 'not_found' response in the interface everywhere
        _getQueue()[0] = WithdrawalRequest(0, 0, payable(0), uint64(block.number), true);
        _getCheckpoints()[getLastCheckpointIndex()] = DiscountCheckpoint(0, 0);
    }

    function _sendValue(address payable _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    //
    // Internal getters and setters
    //
    function _getQueue() internal pure returns (mapping(uint256 => WithdrawalRequest) storage queue) {
        bytes32 position = QUEUE_POSITION;
        assembly {
            queue.slot := position
        }
    }

    function _getCheckpoints() internal pure returns (mapping(uint256 => DiscountCheckpoint) storage checkpoints) {
        bytes32 position = CHECKPOINTS_POSITION;
        assembly {
            checkpoints.slot := position
        }
    }

    function _getRequestByOwner()
        internal
        pure
        returns (mapping(address => EnumerableSet.UintSet) storage requestsByRecipient)
    {
        bytes32 position = REQUEST_BY_OWNER_POSITION;
        assembly {
            requestsByRecipient.slot := position
        }
    }

    function _setLastRequestId(uint256 _lastRequestId) internal {
        LAST_REQUEST_ID_POSITION.setStorageUint256(_lastRequestId);
    }

    function _setLastFinalizedRequestId(uint256 _lastFinalizedRequestId) internal {
        LAST_FINALIZED_REQUEST_ID_POSITION.setStorageUint256(_lastFinalizedRequestId);
    }

    function _setLastCheckpointIndex(uint256 _lastCheckpointIndex) internal {
        LAST_CHECKPOINT_INDEX_POSITION.setStorageUint256(_lastCheckpointIndex);
    }

    function _setLockedEtherAmount(uint256 _lockedEtherAmount) internal {
        LOCKED_ETHER_AMOUNT_POSITION.setStorageUint256(_lockedEtherAmount);
    }
}
