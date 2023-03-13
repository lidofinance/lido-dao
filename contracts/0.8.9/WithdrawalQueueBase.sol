// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";

/// @title Queue to store and manage WithdrawalRequests.
/// @dev Use an optimizations to store max share rates for finalized requests heavily inspired
/// by Aragon MiniMe token https://github.com/aragon/aragon-minime/blob/master/contracts/MiniMeToken.sol
///
/// @author folkyatina
abstract contract WithdrawalQueueBase {
    using EnumerableSet for EnumerableSet.UintSet;
    using UnstructuredStorage for bytes32;

    /// @notice precision base for share rate and discounting factor values in the contract
    uint256 internal constant E27_PRECISION_BASE = 1e27;
    /// @dev maximal length of the batches array that oracle should deliver on finalization
    uint256 public constant MAX_BATCHES_LENGTH = 36;
    /// @dev return value for the `find...` methods in case of no result
    uint256 internal constant NOT_FOUND = 0;

    /// @dev queue for withdrawal requests, indexes (requestId) start from 1
    bytes32 internal constant QUEUE_POSITION = keccak256("lido.WithdrawalQueue.queue");
    /// @dev length of the queue
    bytes32 internal constant LAST_REQUEST_ID_POSITION = keccak256("lido.WithdrawalQueue.lastRequestId");
    /// @dev length of the finalized part of the queue. Always <= `requestCounter`
    bytes32 internal constant LAST_FINALIZED_REQUEST_ID_POSITION =
        keccak256("lido.WithdrawalQueue.lastFinalizedRequestId");
    /// @dev finalization discount history, indexes start from 1
    bytes32 internal constant CHECKPOINTS_POSITION = keccak256("lido.WithdrawalQueue.checkpoints");
    /// @dev length of the checkpoints
    bytes32 internal constant LAST_CHECKPOINT_INDEX_POSITION = keccak256("lido.WithdrawalQueue.lastCheckpointIndex");
    /// @dev amount of eth locked on contract for withdrawal
    bytes32 internal constant LOCKED_ETHER_AMOUNT_POSITION = keccak256("lido.WithdrawalQueue.lockedEtherAmount");
    /// @dev withdrawal requests mapped to the owners
    bytes32 internal constant REQUEST_BY_OWNER_POSITION = keccak256("lido.WithdrawalQueue.requestsByOwner");
    /// @dev timestamp of the last oracle report
    bytes32 internal constant LAST_REPORT_TIMESTAMP_POSITION = keccak256("lido.WithdrawalQueue.lastReportTimestamp");


    /// @notice structure representing a request for withdrawal.
    struct WithdrawalRequest {
        /// @notice sum of the all stETH submitted for withdrawals up to this request
        uint128 cumulativeStETH;
        /// @notice sum of the all shares locked for withdrawal up to this request
        uint128 cumulativeShares;
        /// @notice address that can claim or transfer the request
        address owner;
        /// @notice block.timestamp when the request was created
        uint40 timestamp;
        /// @notice flag if the request was claimed
        bool claimed;
        /// @notice timestamp of last oracle report for this request
        uint40 reportTimestamp;
    }

    /// @notice structure to store discounts for requests that are affected by negative rebase
    struct Checkpoint {
        uint256 fromRequestId;
        uint256 maxShareRate;
    }

    /// @notice output format struct for `_getWithdrawalStatus()` method
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
        /// @notice true, if request is claimed. Request is claimable if (isFinalized && !isClaimed)
        bool isClaimed;
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
        uint256 indexed from, uint256 indexed to, uint256 amountOfETHLocked, uint256 sharesToBurn, uint256 timestamp
    );
    event WithdrawalClaimed(
        uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 amountOfETH
    );

    error ZeroAmountOfETH();
    error ZeroShareRate();
    error ZeroTimestamp();
    error TooMuchEtherToFinalize(uint256 sent, uint256 maxExpected);
    error NotOwner(address _sender, address _owner);
    error InvalidRequestId(uint256 _requestId);
    error InvalidRequestIdRange(uint256 startId, uint256 endId);
    error InvalidState();
    error BatchesAreNotSorted();
    error EmptyBatches();
    error RequestNotFoundOrNotFinalized(uint256 _requestId);
    error NotEnoughEther();
    error RequestAlreadyClaimed(uint256 _requestId);
    error InvalidHint(uint256 _hint);
    error CantSendValueRecipientMayHaveReverted();

    /// @notice id of the last request, returns 0, if no request in the queue
    function getLastRequestId() public view returns (uint256) {
        return LAST_REQUEST_ID_POSITION.getStorageUint256();
    }

    /// @notice id of the last finalized request, returns 0 if no finalized requests in the queue
    function getLastFinalizedRequestId() public view returns (uint256) {
        return LAST_FINALIZED_REQUEST_ID_POSITION.getStorageUint256();
    }

    /// @notice amount of ETH on this contract balance that is locked for withdrawal and available to claim
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

    /// @notice Returns the amount of stETH in the queue yet to be finalized
    function unfinalizedStETH() external view returns (uint256) {
        return
            _getQueue()[getLastRequestId()].cumulativeStETH - _getQueue()[getLastFinalizedRequestId()].cumulativeStETH;
    }

    //
    // FINALIZATION FLOW
    //
    // Process when protocol is fixing the withdrawal request value and lock the required amount of ETH.
    // The value of a request after finalization can be:
    //  - nominal (when the amount of eth locked for this request are equal to the request's stETH)
    //  - discounted (when the amount of eth will be lower, because the protocol share rate dropped
    //   before request is finalized, so it will be equal to `request's shares` * `protocol share rate`)
    // The parameters that are required for finalization are:
    //  - current share rate of the protocol
    //  - id of the last request that can be finalized
    //  - the amount of eth that must be locked for these requests
    // To calculate the eth amount we'll need to know which requests int the queue will be finalized as nominal
    // and which as discounted and the exact value of the discount. It's impossible to calculate without the unbounded
    // loop over the unfinalized part of the queue. So, we need to extract a part of the algorithm off-chain, bring the
    // result with oracle report and check it later and check the resukt later.
    // So, we came to this solution:
    // Off-chain
    // 1. Oracle iterates over the queue off-chain and calculate the id of the latest finalizable request
    // in the queue. Then it splits all the requests that will be finalized into batches the way,
    // that requests in a batch are all nominal or all discounted.
    // And passes them in the report as the array of the ending ids of these batches. So it can be reconstructed like
    // `[lastFinalizedRequestId+1, batches[0]], [batches[0]+1, batches[1]] ... [batches[n-2], batches[n-1]]`
    // 2. Contract checks the validity of the batches on-chain and calculate the amount of eth required to
    //  finalize them. It can be done without unbounded loop using partial sums that are calculated on request enqueueing.
    // 3. Contract marks the request's as finalized and locks the eth for claiming. It also,
    //  set's the discount checkpoint for these request's if required that will be applied on claim for each request's
    // individually depending on request's share rate.

    /// @notice transient state that is used to pass intemediate results between several `calculateFinalizationBatches`
    //   invokations
    struct BatchesCalculationState {
        /// @notice amount of ether available in the protocol that can be used to finalize withdrawal requests
        ///  Will decrease on each invokation and will be equal to the remainder when calculation is finished
        ///  Should be set before the first invokation
        uint256 remainingEthBudget;
        /// @notice flag that is `true` if returned state is final and `false` if more invokations required
        bool finished;
        /// @notice static array to store all the batches ending request id
        uint256[MAX_BATCHES_LENGTH] batches;
        /// @notice length of the filled part of `batches` array
        uint256 batchesLength;
    }

    /// @notice Offchain view for the oracle daemon that calculates how many requests can be finalized within
    /// the given budget and timestamp and share rate limits. Returned requests are split into the batches.
    /// Each batch consist of the requests that all have the share rate below the `_maxShareRate` or above it.
    /// Below you can see an example how 14 requests with different share rates will be split into 5 batches by
    /// this algorithm
    ///
    /// ^ share rate
    /// |
    /// |         • •
    /// |       •    •   • • •
    /// |----------------------•------ _maxShareRate
    /// |   •          •        • • •
    /// | •
    /// +-------------------------------> requestId
    ///  | 1st|  2nd  |3| 4th | 5th  |
    ///
    /// @param _maxShareRate current share rate of the protocol with 1e27 precision
    /// @param _maxTimestamp max timestamp of the request that can be finalized
    /// @param _maxRequestsPerCall max request number that can be processed by the call. Better to me max possible
    ///  number for EL node to handle before hitting `out of gas`. More this number is less calls it will require to
    ///  calculate the result
    /// @param _state structure that accumulates the state across multiple invokations to overcome gas limits.
    ///  To start calculation you should pass `state.remainingEthBudget` and `state.finished == false` and then invoke
    ///  the function with returned `state` until it returns a state with `finished` flag set
    /// @return state that was changed during this function invokation.
    ///  If (state.finished) than calculation is finished and returned `state` is ready to be used
    function calculateFinalizationBatches(
        uint256 _maxShareRate,
        uint256 _maxTimestamp,
        uint256 _maxRequestsPerCall,
        BatchesCalculationState memory _state
    )
        external
        view
        returns (BatchesCalculationState memory)
    {
        if (_state.finished || _state.remainingEthBudget == 0) revert InvalidState();

        uint256 currentId;
        WithdrawalRequest memory prevRequest;
        uint256 prevRequestShareRate;

        if (_state.batchesLength == 0) {
            currentId = getLastFinalizedRequestId() + 1;

            prevRequest = _getQueue()[currentId - 1];
        } else {
            uint256 lastHandledRequestId = _state.batches[_state.batchesLength - 1];
            currentId = lastHandledRequestId + 1;

            prevRequest = _getQueue()[lastHandledRequestId];
            (prevRequestShareRate,,) = _calcBatch(_getQueue()[lastHandledRequestId - 1], prevRequest);
        }

        uint256 nextCallRequestId = currentId + _maxRequestsPerCall;
        uint256 queueLength = getLastRequestId() + 1;

        while (currentId < queueLength && currentId < nextCallRequestId) {
            WithdrawalRequest memory request = _getQueue()[currentId];

            if (request.timestamp > _maxTimestamp) break;  // max timestamp break

            (uint256 requestShareRate, uint256 ethToFinalize, uint256 shares) = _calcBatch(prevRequest, request);

            if (requestShareRate > _maxShareRate) {
                // discounted
                ethToFinalize = (shares * _maxShareRate) / E27_PRECISION_BASE;
            }

            if (ethToFinalize > _state.remainingEthBudget) break; // budget break
            _state.remainingEthBudget -= ethToFinalize;

            if (_state.batchesLength != 0 && (
                // share rate of requests in the same batch can differ by 1-2 wei because of the rounding error
                // (issue: https://github.com/lidofinance/lido-dao/issues/442 )
                // so we're counting requests that are placed during the same report day
                // as equal even if their actual share rate are different
                prevRequest.reportTimestamp == request.reportTimestamp ||
                // both requests are below or
                prevRequestShareRate <= _maxShareRate && requestShareRate <= _maxShareRate ||
                // both are above the line
                prevRequestShareRate > _maxShareRate && requestShareRate > _maxShareRate
            )) {
                _state.batches[_state.batchesLength - 1] = currentId; // extend the last batch
            } else {
                // to be able to check batches on-chain we need it to have fixed max length
                if (_state.batchesLength == MAX_BATCHES_LENGTH) break;

                // create a new batch
                _state.batches[_state.batchesLength] = currentId;
                ++_state.batchesLength;
            }

            prevRequestShareRate = requestShareRate;
            prevRequest = request;
            unchecked{ ++currentId; }
        }

        _state.finished = currentId == queueLength || currentId < nextCallRequestId;

        return _state;
    }

    /// @notice Checks the finalization batches, calculates required ether and the amount of shares to burn and
    /// @param _batches finalization batches calculated offchain using `calculateFinalizationBatches`
    /// @param _maxShareRate max possible share rate that will be used for request finalization with 1e27 precision
    /// @return ethToLock amount of ether that should be sent with `finalize()` method later
    /// @return sharesToBurn amount of shares that belongs tho finalizable requests
    function prefinalize(uint256[] calldata _batches, uint256 _maxShareRate)
        external
        view
        returns (uint256 ethToLock, uint256 sharesToBurn)
    {
        if (_maxShareRate == 0) revert ZeroShareRate();
        if (_batches.length == 0) revert EmptyBatches();

        if (_batches[0] <= getLastFinalizedRequestId()) revert InvalidRequestId(_batches[0]);
        if (_batches[_batches.length - 1] > getLastRequestId()) revert InvalidRequestId(_batches[_batches.length - 1]);

        uint256 currentBatchIndex;
        uint256 prevBatchEndRequestId = getLastFinalizedRequestId();
        WithdrawalRequest memory prevBatchEnd = _getQueue()[prevBatchEndRequestId];
        while (currentBatchIndex < _batches.length) {
            uint256 batchEndRequestId = _batches[currentBatchIndex];
            if (batchEndRequestId <= prevBatchEndRequestId) revert BatchesAreNotSorted();

            WithdrawalRequest memory batchEnd = _getQueue()[batchEndRequestId];

            (uint256 batchShareRate, uint256 stETH, uint256 shares) = _calcBatch(prevBatchEnd, batchEnd);

            if (batchShareRate > _maxShareRate) {
                // discounted
                ethToLock += shares * _maxShareRate / E27_PRECISION_BASE;
            } else {
                // nominal
                ethToLock += stETH;
            }
            sharesToBurn += shares;

            prevBatchEndRequestId = batchEndRequestId;
            prevBatchEnd = batchEnd;
            unchecked{ ++currentBatchIndex; }
        }
    }

    /// @dev Finalize requests in the queue
    ///  Emits WithdrawalBatchFinalized event.
    /// Checks that:
    /// - _amountOfETH is less or equal to the nominal value of all requests to be finalized
    function _finalize(uint256[] memory _batches, uint256 _amountOfETH, uint256 _maxShareRate) internal {
        if (_batches.length == 0) revert EmptyBatches();
        uint256 lastRequestIdToBeFinalized = _batches[_batches.length - 1];
        if (lastRequestIdToBeFinalized > getLastRequestId()) revert InvalidRequestId(lastRequestIdToBeFinalized);
        uint256 lastFinalizedRequestId = getLastFinalizedRequestId();
        if (lastRequestIdToBeFinalized <= lastFinalizedRequestId) revert InvalidRequestId(lastRequestIdToBeFinalized);

        WithdrawalRequest memory lastFinalizedRequest = _getQueue()[lastFinalizedRequestId];
        WithdrawalRequest memory requestToFinalize = _getQueue()[lastRequestIdToBeFinalized];

        uint128 stETHToFinalize = requestToFinalize.cumulativeStETH - lastFinalizedRequest.cumulativeStETH;
        if (_amountOfETH > stETHToFinalize) revert TooMuchEtherToFinalize(_amountOfETH, stETHToFinalize);

        uint256 firstRequestIdToFinalize = lastFinalizedRequestId + 1;
        uint256 lastCheckpointIndex = getLastCheckpointIndex();

        // add a new checkpoint with current finalization max share rate
        _getCheckpoints()[lastCheckpointIndex + 1] = Checkpoint(firstRequestIdToFinalize, _maxShareRate);
        _setLastCheckpointIndex(lastCheckpointIndex + 1);

        _setLockedEtherAmount(getLockedEtherAmount() + _amountOfETH);
        _setLastFinalizedRequestId(lastRequestIdToBeFinalized);

        emit WithdrawalBatchFinalized(
            firstRequestIdToFinalize,
            lastRequestIdToBeFinalized,
            _amountOfETH,
            requestToFinalize.cumulativeShares - lastFinalizedRequest.cumulativeShares,
            block.timestamp
            );
    }

    /// @dev creates a new `WithdrawalRequest` in the queue
    ///  Emits WithdrawalRequested event
    /// Does not check parameters
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

        WithdrawalRequest memory newRequest =  WithdrawalRequest(
            cumulativeStETH,
            cumulativeShares,
            _owner,
            uint40(block.timestamp),
            false,
            uint40(_getLastReportTimestamp())
        );
        _getQueue()[requestId] = newRequest;
        assert(_getRequestsByOwner()[_owner].add(requestId));

        emit WithdrawalRequested(requestId, msg.sender, _owner, _amountOfStETH, _amountOfShares);
    }

    /// @dev Returns status of the withdrawal request with `_requestId` id
    function _getStatus(uint256 _requestId) internal view returns (WithdrawalRequestStatus memory status) {
        if (_requestId == 0 || _requestId > getLastRequestId()) revert InvalidRequestId(_requestId);

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

    /// @dev View function to find a checkpoint hint for `claimWithdrawal()`
    ///  Search will be performed in the range of `[_firstIndex, _lastIndex]`
    ///
    /// NB!: Range search ought to be used to optimize gas cost.
    /// You can utilize the following invariant:
    /// `if (requestId2 > requestId1) than hint2 >= hint1`,
    /// so you can search for `hint2` in the range starting from `hint1`
    ///
    /// @param _requestId request id we are searching the checkpoint for
    /// @param _start index of the left boundary of the search range
    /// @param _end index of the right boundary of the search range
    ///
    /// @return value that hints `claimWithdrawal` to find the discount for the request,
    ///  or 0 if hint not found in the range
    function _findCheckpointHint(uint256 _requestId, uint256 _start, uint256 _end) internal view returns (uint256) {
        if (_requestId == 0) revert InvalidRequestId(_requestId);
        if (_start == 0) revert InvalidRequestIdRange(_start, _end);
        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        if (_end > lastCheckpointIndex) revert InvalidRequestIdRange(_start, _end);
        if (_requestId > getLastFinalizedRequestId()) revert RequestNotFoundOrNotFinalized(_requestId);

        if (_start > _end) return NOT_FOUND; // we have an empty range to search in, so return NOT_FOUND

        // Right boundary
        if (_requestId >= _getCheckpoints()[_end].fromRequestId) {
            // it's the last checkpoint, so it's valid
            if (_end == lastCheckpointIndex) return _end;
            // it fits right before the next checkpoint
            if (_requestId < _getCheckpoints()[_end + 1].fromRequestId) return _end;

            return NOT_FOUND;
        }
        // Left boundary
        if (_requestId < _getCheckpoints()[_start].fromRequestId) {
            return NOT_FOUND;
        }

        // Binary search
        uint256 min = _start;
        uint256 max = _end - 1;

        while (max > min) {
            uint256 mid = (max + min + 1) / 2;
            if (_getCheckpoints()[mid].fromRequestId <= _requestId) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /// @dev Claim `_requestId` request and transfer locked ether to `_recipient`. Emits WithdrawalClaimed event
    /// @param _requestId request id to claim
    /// @param _hint hint for discount checkpoint index to avoid extensive search over the checkpoints.
    /// @param _recipient address to send ether to
    function _claim(uint256 _requestId, uint256 _hint, address _recipient) internal {
        if (_requestId == 0) revert InvalidRequestId(_requestId);
        if (_requestId > getLastFinalizedRequestId()) revert RequestNotFoundOrNotFinalized(_requestId);

        WithdrawalRequest storage request = _getQueue()[_requestId];

        if (request.claimed) revert RequestAlreadyClaimed(_requestId);
        if (request.owner != msg.sender) revert NotOwner(msg.sender, request.owner);

        request.claimed = true;
        assert(_getRequestsByOwner()[request.owner].remove(_requestId));

        uint256 ethWithDiscount = _calculateClaimableEther(request, _requestId, _hint);
        // because of the stETH rounding issue
        // (issue: https://github.com/lidofinance/lido-dao/issues/442 )
        // some dust (1-2 wei per request) will be accumulated upon claiming
        _setLockedEtherAmount(getLockedEtherAmount() - ethWithDiscount);
        _sendValue(payable(_recipient), ethWithDiscount);

        emit WithdrawalClaimed(_requestId, msg.sender, _recipient, ethWithDiscount);
    }

    /// @dev Calculates discounted ether value for `_requestId` using a provided `_hint`. Checks if hint is valid
    /// @return claimableEther discounted eth for `_requestId`. Returns 0 if request is not claimable
    function _calculateClaimableEther(WithdrawalRequest storage _request, uint256 _requestId, uint256 _hint)
        internal
        view
        returns (uint256 claimableEther)
    {
        if (_hint == 0) revert InvalidHint(_hint);

        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        if (_hint > lastCheckpointIndex) revert InvalidHint(_hint);

        Checkpoint memory checkpoint = _getCheckpoints()[_hint];
        // Reverts if requestId is not in range [checkpoint[hint], checkpoint[hint+1])
        // ______(>______
        //    ^  hint
        if (_requestId < checkpoint.fromRequestId) revert InvalidHint(_hint);
        if (_hint < lastCheckpointIndex) {
            // ______(>______(>________
            //       hint    hint+1  ^
            Checkpoint memory nextCheckpoint = _getCheckpoints()[_hint + 1];
            if (nextCheckpoint.fromRequestId <= _requestId) revert InvalidHint(_hint);
        }

        WithdrawalRequest memory prevRequest = _getQueue()[_requestId - 1];
        (uint256 batchShareRate, uint256 eth, uint256 shares) = _calcBatch(prevRequest, _request);

        if (batchShareRate > checkpoint.maxShareRate) {
            eth = shares * checkpoint.maxShareRate / E27_PRECISION_BASE;
        }

        return eth;
    }

    /// @dev quazi-constructor
    function _initializeQueue() internal {
        // setting dummy zero structs in checkpoints and queue beginning
        // to avoid uint underflows and related if-branches
        // 0-index is reserved as 'not_found' response in the interface everywhere
        _getQueue()[0] = WithdrawalRequest(0, 0, address(0), uint40(block.timestamp), true, 0);
        _getCheckpoints()[getLastCheckpointIndex()] = Checkpoint(0, 0);
    }

    function _sendValue(address _recipient, uint256 _amount) internal {
        if (address(this).balance < _amount) revert NotEnoughEther();

        // solhint-disable-next-line
        (bool success,) = _recipient.call{value: _amount}("");
        if (!success) revert CantSendValueRecipientMayHaveReverted();
    }

    /// @dev calculate batch stats (shareRate, stETH and shares) for the batch of `(_preStartRequest, _endRequest]`
    function _calcBatch(
        WithdrawalRequest memory _preStartRequest,
        WithdrawalRequest memory _endRequest
    ) internal pure returns (uint256 shareRate, uint256 stETH, uint256 shares) {
        stETH = _endRequest.cumulativeStETH - _preStartRequest.cumulativeStETH;
        shares = _endRequest.cumulativeShares - _preStartRequest.cumulativeShares;

        shareRate = stETH * E27_PRECISION_BASE / shares;
    }

    //
    // Internal getters and setters for unstructured storage
    //
    function _getQueue() internal pure returns (mapping(uint256 => WithdrawalRequest) storage queue) {
        bytes32 position = QUEUE_POSITION;
        assembly {
            queue.slot := position
        }
    }

    function _getCheckpoints() internal pure returns (mapping(uint256 => Checkpoint) storage checkpoints) {
        bytes32 position = CHECKPOINTS_POSITION;
        assembly {
            checkpoints.slot := position
        }
    }

    function _getRequestsByOwner()
        internal
        pure
        returns (mapping(address => EnumerableSet.UintSet) storage requestsByOwner)
    {
        bytes32 position = REQUEST_BY_OWNER_POSITION;
        assembly {
            requestsByOwner.slot := position
        }
    }

    function _getLastReportTimestamp() internal view returns (uint256) {
        return LAST_REPORT_TIMESTAMP_POSITION.getStorageUint256();
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

    function _setLastReportTimestamp(uint256 _lastReportTimestamp) internal {
        LAST_REPORT_TIMESTAMP_POSITION.setStorageUint256(_lastReportTimestamp);
    }
}
