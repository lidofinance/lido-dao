import "./StEth.spec"
import "./WStEth.spec"

using StETHMock as STETH
using DummyERC20 as WSTETH

methods {
    // WithdrawalQueue
    initialize(address) // check if one can initialize more than once and who can initialize.
    resume()
    pauseFor(uint256)
    pauseUntil(uint256)
    claimWithdrawalTo(uint256, uint256, address)
    claimWithdrawal(uint256)
    requestWithdrawals(uint256[], address) returns (uint256[])
    findCheckpointHints(uint256[], uint256, uint256) returns (uint256[])
    finalize(uint256[], uint256)
    onOracleReport(bool, uint256, uint256)
    updateBunkerMode(bool, uint256)
    isBunkerModeActive() returns (bool) envfree
    bunkerModeSinceTimestamp() returns (uint256) envfree

    // WithdrawalQueueBase
    unfinalizedRequestNumber() returns (uint256) envfree
    unfinalizedStETH() returns (uint256) envfree
    finalizationBatch(uint256, uint256) returns (uint256, uint256) envfree

    // WithdrawalQueueHarness:
    getWithdrawalRequests(address) returns (uint256[]) envfree
    isRequestStatusClaimed(uint256) returns (bool) envfree
    isRequestStatusFinalized(uint256) returns (bool) envfree
    getRequestsStatusOwner(uint256) returns (address) envfree
    getRequestsStatusAmountOfShares(uint256) returns (uint256) envfree
    getRequestsStatusAmountOfStETH(uint256) returns (uint256) envfree
    getRequestsStatusTimestamp(uint256) returns (uint256) envfree
    requestWithdrawal(uint256, address) returns (uint256)
    claimWithdrawal(uint256, uint256)
    getFinalizedAndNotClaimedEth() returns (uint256) envfree
    finalizeSingleBatch(uint256, uint256)
    calculateClaimableEther(uint256) returns (uint256) envfree
    requestWithdrawalsHarness(uint256, address) returns (uint256)
    requestWithdrawalsWstEthHarness(uint256, address) returns (uint256)

    // Getters:
    // WithdrawalQueueBase:
    getLastRequestId() returns (uint256) envfree
    getLastFinalizedRequestId() returns (uint256) envfree
    getLastCheckpointIndex() returns (uint256) envfree
    getLockedEtherAmount() returns (uint256) envfree

    // WithdrawalQueue:
    MIN_STETH_WITHDRAWAL_AMOUNT() returns (uint256) envfree
    MAX_STETH_WITHDRAWAL_AMOUNT() returns (uint256) envfree
    BUNKER_MODE_DISABLED_TIMESTAMP() returns (uint256) envfree

    // WithdrawalQueueHarness:
    getRequestCumulativeStEth(uint256) returns(uint128) envfree
    getRequestCumulativeShares(uint256) returns(uint128) envfree
    getRequestOwner(uint256) returns (address) envfree
    getRequestTimestamp(uint256) returns (uint40) envfree
    getRequestClaimed(uint256) returns (bool) envfree
    getRequestReportTimestamp(uint256) returns (uint40) envfree
    getCheckpointFromRequestId(uint256) returns (uint256) envfree
    getCheckpointMaxShareRate(uint256) returns (uint256) envfree
    getLastReportTimestamp() returns (uint256) envfree
    getClaimableEther(uint256, uint256) returns (uint256) envfree
    balanceOfEth(address) returns (uint256) envfree
}

/**************************************************
 *                METHOD INTEGRITY                *
 **************************************************/

/**
After calling requestWithdrawals:
    1. the stEth.shares of the user should decrease 
    2. the contract’s stEth.shares should increase by the same amount.
    3. generate the desired withdrawal request.
 **/
rule integrityOfRequestWithdrawal(address owner, uint256 amount) {
    env e;
    require e.msg.sender != currentContract && e.msg.sender != 0;
    uint256 stEthBalanceBefore = STETH.sharesOf(e.msg.sender);
    uint256 contractStEthBalanceBefore = STETH.sharesOf(currentContract);

    uint256 lastCumulativeStEth = getRequestCumulativeStEth(getLastRequestId());

    uint256 actualShares = STETH.getSharesByPooledEth(amount);

    uint256 requestId = requestWithdrawalsHarness(e, amount, owner);

    uint256 stEthBalanceAfter = STETH.sharesOf(e.msg.sender);
    uint256 contractStEthBalanceAfter = STETH.sharesOf(currentContract);
    uint256 reqCumulativeStEth = getRequestCumulativeStEth(requestId);
    address reqOwner = getRequestOwner(requestId);

    assert requestId == getLastRequestId();
    assert stEthBalanceBefore - actualShares == stEthBalanceAfter;
    assert contractStEthBalanceBefore + actualShares == contractStEthBalanceAfter;
    assert reqCumulativeStEth == lastCumulativeStEth + amount;
    assert (reqOwner == owner && reqOwner != 0) || reqOwner == e.msg.sender;
}

/**
After calling requestWithdrawalsWstEth:
    1. the WSTETH.balanceOf of the user should decrease by amount
    2. the contract’s WSTETH.balanceOf should increase by the same amount.
    3. generate the desired withdrawal request.
 **/
rule integrityOfRequestWithdrawalsWstEth(address owner, uint256 amount) {
    env e;
    require e.msg.sender != currentContract;
    uint256 wstEthBalanceBefore = WSTETH.balanceOf(e.msg.sender);
    uint256 contractWstEthBalanceBefore = WSTETH.balanceOf(currentContract);

    uint256 lastCumulativeStEth = getRequestCumulativeStEth(getLastRequestId());

    uint256 amountOfStETH = WSTETH.unwrap(e, amount);

    uint256 requestId = requestWithdrawalsWstEthHarness(e, amount, owner);

    uint256 wstEthBalanceAfter = WSTETH.balanceOf(e.msg.sender);
    uint256 contractWtEthBalanceAfter = WSTETH.balanceOf(currentContract);
    uint256 reqCumulativeStEth = getRequestCumulativeStEth(requestId);
    address reqOwner = getRequestOwner(requestId);

    assert requestId == getLastRequestId();
    assert wstEthBalanceBefore - amount == wstEthBalanceAfter;
    assert contractWstEthBalanceBefore + amount == contractWtEthBalanceAfter;
    assert reqCumulativeStEth == lastCumulativeStEth + amountOfStETH;
    assert (reqOwner == owner && reqOwner != 0) || reqOwner == e.msg.sender;
}

/** 
After calling claimWithdrawal, if the user’s ETH balance was increased then:
    1.The locked ETH amount should decreased
    2.The request’s claimed and finalized flags are on.
    3.The request-id is smaller than the last finalized request id
**/
rule integrityOfClaimWithdrawal(uint256 requestId) {
    env e;
    require requestId > 0;
    requireInvariant cantWithdrawLessThanMinWithdrawal(requestId);
    requireInvariant cumulativeEtherGreaterThamMinWithdrawal(requestId);
    bool isClaimedBefore = isRequestStatusClaimed(requestId);
    bool isFinalized = isRequestStatusFinalized(requestId);
    uint256 ethBalanceBefore = balanceOfEth(e.msg.sender);
    uint256 lockedEthBefore = getLockedEtherAmount();
    require calculateClaimableEther(requestId) > 0;
    
    claimWithdrawal(e, requestId);

    uint256 ethBalanceAfter = balanceOfEth(e.msg.sender);
    uint256 lockedEthAfter = getLockedEtherAmount();
    bool isClaimedAfter = isRequestStatusClaimed(requestId);

    assert ethBalanceAfter > ethBalanceBefore && lockedEthBefore > lockedEthAfter && 
                                                 !isClaimedBefore && isClaimedAfter && isFinalized &&
                                                 (requestId <= getLastFinalizedRequestId());
    assert ethBalanceAfter - ethBalanceBefore == lockedEthBefore - lockedEthAfter;
    assert e.msg.sender == getRequestOwner(requestId);
}

/** 
After calling finalize, the locked ETH amount is increased and the last finalized request-id should update accordingly.
**/
rule integrityOfFinalize(uint256 lastIdToFinalize, uint256 maxShareRate) {
    env e;
    uint256 lockedEtherAmountBefore = getLockedEtherAmount();
    uint256 lastFinalizedRequestIdBefore = getLastFinalizedRequestId();

    finalizeSingleBatch(e, lastIdToFinalize, maxShareRate);

    uint256 lockedEtherAmountAfter = getLockedEtherAmount();
    uint256 finalizedRequestsCounterAfter = getLastFinalizedRequestId();

    assert lockedEtherAmountAfter >= lockedEtherAmountBefore + e.msg.value;
    assert finalizedRequestsCounterAfter == lastIdToFinalize;
    assert lastFinalizedRequestIdBefore <= lastIdToFinalize;
}


/**************************************************
 *                   HIGH LEVEL                   *
 **************************************************/

/** 
With the right conditions, user can always claim his request.
**/
// rule abilityToClaim(uint256 reqId) {
//     env e;
//     require balanceOfEth(currentContract) == max_uint256;
//     require balanceOfEth(e.msg.sender) == 0;
//     require e.msg.value == 0;
//     require reqId > 0;
//     require reqId <= getLastFinalizedRequestId();
//     require !getRequestClaimed(reqId);
//     require e.msg.sender == getRequestOwner(reqId);
//     require addRequestByOwnerExists(reqId, e.msg.sender);

//     claimWithdrawal@withrevert(e, reqId);

//     assert !lastReverted;
// }

/** 
If there is a new checkpoint index then the last finalized request id must have increased.
**/
rule priceIndexFinalizedRequestsCounterCorelation(method f) {
    env e;
    calldataarg args;
    uint256 latestIndexBefore = getLastCheckpointIndex();
    uint256 finalizedRequestsCounterBefore = getLastFinalizedRequestId();

    f(e, args);

    uint256 latestIndexAfter = getLastCheckpointIndex();
    uint256 finalizedRequestsCounterAfter = getLastFinalizedRequestId();

    assert latestIndexAfter != latestIndexBefore => finalizedRequestsCounterAfter > finalizedRequestsCounterBefore;
}

/**
If there is a new checkpoint index then the Checkpoint's fromRequestId index should increase.
**/
rule newCheckpoint(uint256 requestIdToFinalize, uint256 maxShareRate) {
    env e;

    requireInvariant cantWithdrawLessThanMinWithdrawal(requestIdToFinalize);
    requireInvariant CheckpointFromRequestIdisValid(getLastCheckpointIndex());

    uint256 checkpointIndexLenBefore = getLastCheckpointIndex();
    uint256 lastCheckpointFromRequestIdBefore = getCheckpointFromRequestId(checkpointIndexLenBefore);

    require checkpointIndexLenBefore < max_uint256 - 1;

    finalizeSingleBatch(e, requestIdToFinalize, maxShareRate);

    uint256 checkpointIndexLenAfter = getLastCheckpointIndex();
    uint256 lastCheckpointFromRequestIdAfter = getCheckpointFromRequestId(checkpointIndexLenAfter);

    assert checkpointIndexLenAfter == checkpointIndexLenBefore + 1 <=> 
        (lastCheckpointFromRequestIdAfter > lastCheckpointFromRequestIdBefore);
}

/**
Checkpoint history is preserved.
**/
rule preserveCheckpointHistory(method f, uint256 index) 
    filtered{ f -> f.selector != initialize(address).selector } 
    {
    env e;
    calldataarg args;

    uint256 fromRequestIdBefore = getCheckpointFromRequestId(index);
    uint256 maxShareRateBefore = getCheckpointMaxShareRate(index);

    uint256 lastCheckPointIndexBefore = getLastCheckpointIndex();

    f(e, args);

    uint256 fromRequestIdAfter = getCheckpointFromRequestId(index);
    uint256 maxShareRateAfter = getCheckpointMaxShareRate(index);

    assert index <= lastCheckPointIndexBefore => (fromRequestIdBefore == fromRequestIdAfter && maxShareRateBefore == maxShareRateAfter);
}

/**
Claim the same withdrawal request twice and assert there are no changes after the second claim or the code reverts.
**/
rule claimSameWithdrawalRequestTwice(uint256 requestId) {
    env e;
   
    claimWithdrawal(e, requestId);

    uint256 ethBalanceAfterFirst = balanceOfEth(e.msg.sender);
    uint256 lockedEthAfterFirst = getLockedEtherAmount();
    bool isClaimedAfterFirst = isRequestStatusClaimed(requestId);

    claimWithdrawal@withrevert(e, requestId);

    bool isRevert = lastReverted;

    uint256 ethBalanceAfterSecond = balanceOfEth(e.msg.sender);
    uint256 lockedEthAfterSecond = getLockedEtherAmount();
    bool isClaimedAfterSecond = isRequestStatusClaimed(requestId);

    assert isRevert || ethBalanceAfterFirst == ethBalanceAfterSecond;
    assert isRevert || lockedEthAfterFirst == lockedEthAfterSecond;
    assert isRevert || isClaimedAfterFirst && isClaimedAfterSecond;
}

/**
Claimed withdrawal request cant be unclaimed.
**/
rule onceClaimedAlwaysClaimed(method f, uint256 requestId) 
    {
    env e;
    calldataarg args;

    bool isClaimedBefore = isRequestStatusClaimed(requestId);

    f(e, args);

    bool isClaimedAfter = isRequestStatusClaimed(requestId);

    assert isClaimedBefore => isClaimedAfter;
}

/**************************************************
 *                   INVARIANTS                   *
 **************************************************/

/**
The last finalized request-id is always less than the last request-id.
**/
invariant finalizedRequestsCounterisValid()
    getLastFinalizedRequestId() <= getLastRequestId()
    
/**
Cant withdraw less than the minimum amount or more than the maximum amount.
minimum withdrawal rule. min withdrawal == 0.1 ether == 10 ^ 17
**/
invariant cantWithdrawLessThanMinWithdrawal(uint256 reqId) 
    (reqId <= getLastRequestId() && reqId >= 1) => (
                                getRequestCumulativeStEth(reqId) - getRequestCumulativeStEth(reqId - 1) >= MIN_STETH_WITHDRAWAL_AMOUNT() &&
                                getRequestCumulativeStEth(reqId) - getRequestCumulativeStEth(reqId - 1) <= MAX_STETH_WITHDRAWAL_AMOUNT()
                            )
        {
            preserved 
            {
                requireInvariant cumulativeEtherGreaterThamMinWithdrawal(reqId);
                require reqId > 1;
            }
        }                    

/**
Each request’s cumulative ETH must be greater than the minimum withdrawal amount.
**/
invariant cumulativeEtherGreaterThamMinWithdrawal(uint256 reqId)
    (reqId <= getLastRequestId() && reqId >= 1) => (getRequestCumulativeStEth(reqId) >= MIN_STETH_WITHDRAWAL_AMOUNT())

/**
Cumulative ETH and cumulative shares are monotonic increasing.
**/
invariant cumulativeEthMonotonocInc(uint256 reqId)
        reqId <= getLastRequestId() => (reqId > 0 => getRequestCumulativeStEth(reqId) > getRequestCumulativeStEth(reqId - 1)) &&
                                      (reqId > 0 => getRequestCumulativeShares(reqId) >= getRequestCumulativeShares(reqId - 1))
        {
            preserved 
            {
                require getRequestCumulativeStEth(0) == 0;
                require getRequestCumulativeShares(0) == 0;
            }
        }

/**
If the request-id is greater than the last finalized request-id then the request’s claimed and finalized flags are off.
**/
invariant finalizedCounterFinalizedFlagCorrelation(uint256 requestId)
    requestId > getLastFinalizedRequestId() <=> !isRequestStatusFinalized(requestId)

/**
If a request is not finalized then it is not claimed.
**/
invariant claimedFinalizedFlagsCorrelation(uint256 requestId)
    isRequestStatusClaimed(requestId) => isRequestStatusFinalized(requestId)

/** 
Finaliztion FIFO order is preserved.
**/
invariant finalizationFifoOrder(uint256 requestId1, uint256 requestId2) 
    (requestId2 <= getLastRequestId() && requestId1 >= 1 && requestId1 < requestId2) => (isRequestStatusFinalized(requestId2) => isRequestStatusFinalized(requestId1))

/**
Checkpoint's FromRequestId should always be less than the last finalized request-id.
**/
invariant CheckpointFromRequestIdisValid(uint256 checkpointIndex)
    getCheckpointFromRequestId(checkpointIndex) <= getLastFinalizedRequestId()

/**
Checkpoint's FromRequestId is monotincally increasing.
**/
invariant CheckpointFromRequestIdMonotonic(uint256 checkpointIndex1, uint256 checkpointIndex2)
    (checkpointIndex2 > checkpointIndex1) => (getCheckpointFromRequestId(checkpointIndex2) > getCheckpointFromRequestId(checkpointIndex1))
    filtered { f -> f.selector != initialize(address).selector }
    {
        preserved {
            requireInvariant CheckpointFromRequestIdisValid(checkpointIndex2);
        }
    }

// /**
// Locked ETH should always be greater or equal to finalized and not claimed ether amount 
// **/
// lockedEtherSolvencyParametric
//     getLockedEtherAmount() >= getFinalizedAndNotClaimedEth()
//         {
//             preserved 
//             {
//                 requireInvariant cantWithdrawLessThanMinWithdrawal(getLastFinalizedRequestId());
//                 require getRequestCumulativeStEth(0) == 0;
//                 require getRequestCumulativeShares(0) == 0;
//             }
//         }

