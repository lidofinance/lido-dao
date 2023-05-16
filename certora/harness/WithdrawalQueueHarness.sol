// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "../munged/WithdrawalQueue.sol";
import "@openzeppelin/contracts-v4.4/utils/structs/EnumerableSet.sol";

contract WithdrawalQueueHarness is WithdrawalQueue {

    constructor(IWstETH _wstETH)WithdrawalQueue(_wstETH) {}

    // WithdrawalRewuest Getters:
    function getRequestCumulativeStEth(uint256 requestId) public view returns (uint128) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.cumulativeStETH;
    }

    function getRequestCumulativeShares(uint256 requestId) public view returns (uint128) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.cumulativeShares;
    }

    function getRequestOwner(uint256 requestId) public view returns (address) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.owner;
    }

    function getRequestTimestamp(uint256 requestId) public view returns (uint40) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.timestamp;
    }

    function getRequestClaimed(uint256 requestId) public view returns (bool) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.claimed;
    }

    function getRequestReportTimestamp(uint256 requestId) public view returns (uint40) {
        WithdrawalRequest memory request = _getQueue()[requestId];
        return request.reportTimestamp;
    }

    // WithdrawalRequestStatus Getters:
    function getRequestsStatusAmountOfStETH(uint256 requestId) public view returns (uint256) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.amountOfStETH;
    }

    function getRequestsStatusAmountOfShares(uint256 requestId) public view returns (uint256) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.amountOfShares;
    }

    function getRequestsStatusTimestamp(uint256 requestId) public view returns (uint256) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.timestamp;
    }

    function getRequestsStatusOwner(uint256 requestId) public view returns (address) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.owner;
    }

    function isRequestStatusClaimed(uint256 requestId) public returns (bool) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.isClaimed;
    }

    function isRequestStatusFinalized(uint256 requestId) public returns (bool) {
        WithdrawalRequestStatus memory req = _getStatus(requestId);
        return req.isFinalized;
    }

    // Checkpoint Getters:
    function getCheckpointFromRequestId(uint256 checkpointIndex) public view returns (uint256) {
        uint256 lastCheckpointIndex = getLastCheckpointIndex();
        require (lastCheckpointIndex >= checkpointIndex);
        Checkpoint memory checkpoint = _getCheckpoints()[checkpointIndex];
        return checkpoint.fromRequestId;
    }

    function getCheckpointMaxShareRate(uint256 checkpointIndex) public view returns (uint256) {
        Checkpoint memory checkpoint = _getCheckpoints()[checkpointIndex];
        return checkpoint.maxShareRate;
    }

    function getLastReportTimestamp() public view returns (uint256) {
        return _getLastReportTimestamp();
    }


    function getClaimableEther(uint256 _requestId, uint256 _hint) public view returns (uint256) {
        return _getClaimableEther(_requestId, _hint);
    }

    function balanceOfEth(address user) public view returns(uint256)
    {
        return user.balance;
    }

    function _emitTransfer(address from, address to, uint256 _requestId) internal override {}

    function requestWithdrawal(uint256 amount, address _owner) public returns (uint256) {
        _checkWithdrawalRequestAmount(amount);
        return _requestWithdrawal(amount, _owner);
    }

    function requestWithdrawalsHarness(uint256 amount, address _owner) public returns (uint256) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory res = requestWithdrawals(amounts, _owner);
        return res[0];
    }

    function requestWithdrawalsWstEthHarness(uint256 amount, address _owner) public returns (uint256) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory res = requestWithdrawalsWstETH(amounts, _owner);
        return res[0];
    }

    function claimWithdrawal(uint256 requestId, uint256 hintIndex) public {
        _claim(requestId, hintIndex, msg.sender);
    }

    function finalizeSingleBatch(uint256 lastReqIdToFinalize, uint256 _maxShareRate)
        public
        payable
    {
        uint256[] memory _batches = new uint256[](1);
        _batches[0] = lastReqIdToFinalize;
        
        _checkResumed();
        _checkRole(FINALIZE_ROLE, msg.sender);

        _finalize(_batches, msg.value, _maxShareRate);
    }

    function getFinalizedAndNotClaimedEth() public returns (uint256) {
        uint256 res = 0;
        uint256 lastFinalizedRequestId = getLastFinalizedRequestId();

        for (uint256 requestId = 1; requestId <= lastFinalizedRequestId; requestId++) {
            WithdrawalRequest storage request = _getQueue()[requestId];
            if (!request.claimed) {
                res += _calculateClaimableEther(request, requestId, _findCheckpointHint(requestId, 1, getLastCheckpointIndex()));
            }
        }

        return res;
    }

    function calculateClaimableEther(uint256 requestId) public view returns (uint256) {
        WithdrawalRequest storage request = _getQueue()[requestId];
        return _calculateClaimableEther(request, requestId, _findCheckpointHint(requestId, 1, getLastCheckpointIndex()));
    }


    // }
}
