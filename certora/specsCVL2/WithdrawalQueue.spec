// After CVL2 migration, this spec results the following error:
// CRITICAL: java.lang.IllegalArgumentException: Element class kotlinx.serialization.json.JsonLiteral is not a JsonArray

//import "./StEth.spec"
//import "./WStEth.spec"

using StETHMock as STETH;
using DummyERC20 as WSTETH;

methods {
    // StEth
    function STETH.name()                                external returns (string) envfree;
    function STETH.symbol()                              external returns (string) envfree;
    function STETH.decimals()                            external returns (uint8) envfree;
    function STETH.totalSupply()                         external returns (uint256) envfree;
    function STETH.balanceOf(address)                    external returns (uint256) envfree;
    function STETH.allowance(address,address)            external returns (uint256);
    function STETH.approve(address,uint256)              external returns (bool);
    function STETH.transfer(address,uint256)             external returns (bool);
    function STETH.transferFrom(address,address,uint256) external returns (bool);
    function STETH.increaseAllowance(address, uint256) external returns (bool);
    function STETH.decreaseAllowance(address, uint256) external returns (bool);

    function STETH.getTotalPooledEther() external returns (uint256) envfree;
    function STETH.getTotalShares() external returns (uint256) envfree;
    function STETH.sharesOf(address) external returns (uint256) envfree;
    function STETH.getSharesByPooledEth(uint256) external returns (uint256) envfree;
    function STETH.getPooledEthByShares(uint256) external returns (uint256) envfree;
    function STETH.transferShares(address, uint256) external returns (uint256);
    function STETH.transferSharesFrom(address, address, uint256) external returns (uint256);

    // WStEth
    function WSTETH.totalSupply()                         external returns (uint256) envfree;
    function WSTETH.balanceOf(address)                    external returns (uint256) envfree;
    function WSTETH.allowance(address,address)            external returns (uint256);
    function WSTETH.approve(address,uint256)              external returns (bool);
    function WSTETH.transfer(address,uint256)             external returns (bool);
    function WSTETH.transferFrom(address,address,uint256) external returns (bool);
    function WSTETH.unwrap(uint256) external returns (uint256);

    // WithdrawalQueue
    function initialize(address) external; // check if one can initialize more than once and who can initialize.
    function resume() external;
    function pauseFor(uint256) external;
    function pauseUntil(uint256) external;
    function claimWithdrawalTo(uint256, uint256, address) external;
    function claimWithdrawal(uint256) external;
    function requestWithdrawals(uint256[], address) external returns (uint256[]);
    function findCheckpointHints(uint256[], uint256, uint256) external returns (uint256[]);
    function finalize(uint256[], uint256) external;
    function onOracleReport(bool, uint256, uint256) external;
    function updateBunkerMode(bool, uint256) external;
    function isBunkerModeActive() external returns (bool) envfree;
    function bunkerModeSinceTimestamp() external returns (uint256) envfree;

    // WithdrawalQueueBase
    function unfinalizedRequestNumber() external returns (uint256) envfree;
    function unfinalizedStETH() external returns (uint256) envfree;
    function finalizationBatch(uint256, uint256) external returns (uint256, uint256) envfree;

    // WithdrawalQueueHarness:
    function getWithdrawalRequests(address) external returns (uint256[]) envfree;
    function isRequestStatusClaimed(uint256) external returns (bool) envfree;
    function isRequestStatusFinalized(uint256) external returns (bool) envfree;
    function getRequestsStatusOwner(uint256) external returns (address) envfree;
    function getRequestsStatusAmountOfShares(uint256) external returns (uint256) envfree;
    function getRequestsStatusAmountOfStETH(uint256) external returns (uint256) envfree;
    function getRequestsStatusTimestamp(uint256) external returns (uint256) envfree;
    function requestWithdrawal(uint256, address) external returns (uint256);
    function claimWithdrawal(uint256, uint256) external;
    function getFinalizedAndNotClaimedEth() external returns (uint256) envfree;
    function finalizeSingleBatch(uint256, uint256) external;
    function calculateClaimableEther(uint256) external returns (uint256) envfree;
    function requestWithdrawalsHarness(uint256, address) external returns (uint256);
    function requestWithdrawalsWstEthHarness(uint256, address) external returns (uint256);

    // Getters:
    // WithdrawalQueueBase:
    function getLastRequestId() external returns (uint256) envfree;
    function getLastFinalizedRequestId() external returns (uint256) envfree;
    function getLastCheckpointIndex() external returns (uint256) envfree;
    function getLockedEtherAmount() external returns (uint256) envfree;

    // WithdrawalQueue:
    function MIN_STETH_WITHDRAWAL_AMOUNT() external returns (uint256) envfree;
    function MAX_STETH_WITHDRAWAL_AMOUNT() external returns (uint256) envfree;
    function BUNKER_MODE_DISABLED_TIMESTAMP() external returns (uint256) envfree;

    // WithdrawalQueueHarness:
    function getRequestCumulativeStEth(uint256) external returns(uint128) envfree;
    function getRequestCumulativeShares(uint256) external returns(uint128) envfree;
    function getRequestOwner(uint256) external returns (address) envfree;
    function getRequestTimestamp(uint256) external returns (uint40) envfree;
    function getRequestClaimed(uint256) external returns (bool) envfree;
    function getRequestReportTimestamp(uint256) external returns (uint40) envfree;
    function getCheckpointFromRequestId(uint256) external returns (uint256) envfree;
    function getCheckpointMaxShareRate(uint256) external returns (uint256) envfree;
    function getLastReportTimestamp() external returns (uint256) envfree;
    function getClaimableEther(uint256, uint256) external returns (uint256) envfree;
    function balanceOfEth(address) external returns (uint256) envfree;
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
    filtered{ f -> f.selector != sig:initialize(address).selector } 
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
    getLastFinalizedRequestId() <= getLastRequestId();
    
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
    (reqId <= getLastRequestId() && reqId >= 1) => (getRequestCumulativeStEth(reqId) >= MIN_STETH_WITHDRAWAL_AMOUNT());

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
    requestId > getLastFinalizedRequestId() <=> !isRequestStatusFinalized(requestId);

/**
If a request is not finalized then it is not claimed.
**/
invariant claimedFinalizedFlagsCorrelation(uint256 requestId)
    isRequestStatusClaimed(requestId) => isRequestStatusFinalized(requestId);

/** 
Finaliztion FIFO order is preserved.
**/
invariant finalizationFifoOrder(uint256 requestId1, uint256 requestId2) 
    (requestId2 <= getLastRequestId() && requestId1 >= 1 && requestId1 < requestId2) => (isRequestStatusFinalized(requestId2) => isRequestStatusFinalized(requestId1));

/**
Checkpoint's FromRequestId should always be less than the last finalized request-id.
**/
invariant CheckpointFromRequestIdisValid(uint256 checkpointIndex)
    getCheckpointFromRequestId(checkpointIndex) <= getLastFinalizedRequestId();

/**
Checkpoint's FromRequestId is monotincally increasing.
**/
invariant CheckpointFromRequestIdMonotonic(uint256 checkpointIndex1, uint256 checkpointIndex2)
    (checkpointIndex2 > checkpointIndex1) => (getCheckpointFromRequestId(checkpointIndex2) > getCheckpointFromRequestId(checkpointIndex1))
    filtered { f -> f.selector != sig:initialize(address).selector }
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

