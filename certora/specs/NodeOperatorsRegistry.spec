import "./NodeRegistryMethods.spec"

methods {
    getNodeOperatorsCount() returns (uint256) envfree
    getActiveNodeOperatorsCount() returns (uint256) envfree
    getNodeOperatorIsActive(uint256) returns (bool) envfree
    MAX_NODE_OPERATORS_COUNT() returns (uint256) envfree

    getRewardsDistributionShare(uint256, uint256) returns (uint256, uint256)
    getSummaryTotalExitedValidators() returns (uint256) envfree
    getSummaryTotalDepositedValidators() returns (uint256) envfree
    getSummaryTotalKeyCount() returns (uint256) envfree
    getSummaryMaxValidators() returns (uint256) envfree
    getNodeOperator_stuckValidators(uint256) returns (uint256) envfree
    getNodeOperator_refundedValidators(uint256) returns (uint256) envfree
    getNodeOperator_endTimeStamp(uint256) returns (uint256) envfree
    getNodeOperatorSigningStats_exited(uint256) returns (uint64) envfree
    getNodeOperatorSigningStats_vetted(uint256) returns (uint64) envfree
    getNodeOperatorSigningStats_deposited(uint256) returns (uint64) envfree
    getNodeOperatorSigningStats_total(uint256) returns (uint64) envfree
}

definition UINT64_MAX() returns uint64 = 0xFFFFFFFFFFFFFFFF;

/**************************************************
 *                  Methdos defitions             *
 **************************************************/

definition isFinalizeUpgrade(method f) returns bool = 
    f.selector == finalizeUpgrade_v2(address, bytes32, uint256).selector;

definition isObtainDepData(method f) returns bool = 
    f.selector == obtainDepositData(uint256, bytes).selector;

definition isAddSignKeys(method f) returns bool = 
    f.selector == addSigningKeys(uint256, uint256, bytes, bytes).selector;

/**************************************************
 *                 Invariants Helpers             *
 **************************************************/

// Makes sure that if there are any inactive operators, then the sum of active operators
// is strictly less than the sum of all operators accordingly.
function activeOperatorsSumHelper(uint256 id1, uint256 id2) {
    require (id1 != id2 && !getNodeOperatorIsActive(id1) && !getNodeOperatorIsActive(id2)
    && id1 < getNodeOperatorsCount() && id2 < getNodeOperatorsCount()) => 
        getActiveNodeOperatorsCount() + 2 <= getNodeOperatorsCount();

    require (id1 == id2 && !getNodeOperatorIsActive(id1) && id1 < getNodeOperatorsCount()) =>
        getActiveNodeOperatorsCount() + 1 <= getNodeOperatorsCount();
}

function safeAssumptions_NOS(uint256 nodeOperatorId) {
    requireInvariant NodeOperatorsCountLEMAX();
    requireInvariant ActiveOperatorsLECount();
    requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
}

/**************************************************
 *                  Invariants                    *
 **************************************************/
invariant NodeOperatorsCountLEMAX()
    getNodeOperatorsCount() <= MAX_NODE_OPERATORS_COUNT()

invariant ActiveOperatorsLECount()
    getActiveNodeOperatorsCount() <= getNodeOperatorsCount()
    {
        preserved {
            requireInvariant NodeOperatorsCountLEMAX();
        }

        preserved activateNodeOperator(uint256 id) with (env e) {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant AllModulesAreActiveConsistency(id);
        }
    }

invariant AllModulesAreActiveConsistency(uint256 nodeOperatorId)
    (
        (getActiveNodeOperatorsCount() == getNodeOperatorsCount() &&
        nodeOperatorId < getActiveNodeOperatorsCount()) 
        => getNodeOperatorIsActive(nodeOperatorId)
    ) 
    {
        preserved {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ActiveOperatorsLECount();
        }

        preserved activateNodeOperator(uint256 id) with (env e) {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ActiveOperatorsLECount();
            requireInvariant AllModulesAreActiveConsistency(id); 
            activeOperatorsSumHelper(id, nodeOperatorId);
        }

        preserved deactivateNodeOperator(uint256 id) with (env e) {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ActiveOperatorsLECount();
            requireInvariant AllModulesAreActiveConsistency(id);
        }
    }


invariant ExitedKeysLEDepositedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_exited(nodeOperatorId) <=
    getNodeOperatorSigningStats_deposited(nodeOperatorId)
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
        }
    }

invariant DepositedKeysLEVettedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_deposited(nodeOperatorId) <=
    getNodeOperatorSigningStats_vetted(nodeOperatorId)
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
            requireInvariant VettedKeysLETotalKeys(nodeOperatorId);
        }

        preserved invalidateReadyToDepositKeysRange(uint256 _indexFrom, uint256 _indexTo) with (env e){
            //require _indexTo < 3;
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(_indexFrom);
            requireInvariant DepositedKeysLEVettedKeys(_indexFrom);
            requireInvariant ExitedKeysLEDepositedKeys(_indexTo);
            requireInvariant DepositedKeysLEVettedKeys(_indexTo);

        }
    }

invariant VettedKeysLETotalKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_vetted(nodeOperatorId) <=
    getNodeOperatorSigningStats_total(nodeOperatorId)
    {
        preserved {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(0);
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
            requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
        }

        preserved invalidateReadyToDepositKeysRange(uint256 _indexFrom, uint256 _indexTo) with (env e){
            //require _indexTo < 3;
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(_indexFrom);
            requireInvariant DepositedKeysLEVettedKeys(_indexFrom);
            requireInvariant ExitedKeysLEDepositedKeys(_indexTo);
            requireInvariant DepositedKeysLEVettedKeys(_indexTo);
        }
    }

/**************************************************
 *        NodeOperatorsRegistry (NOS) Rules       *
 **************************************************/

 rule canAlwaysDeactivateAddedNodeOperator() {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.value == e2.msg.value;

    string name; require name.length == 32;
    address rewardAddress;
    uint256 nodeOperatorId = getNodeOperatorsCount();
    safeAssumptions_NOS(nodeOperatorId);
    addNodeOperator(e1, name, rewardAddress);

    deactivateNodeOperator@withrevert(e2, nodeOperatorId);
    assert !lastReverted;
 }

 rule canDeactivateAfterActivate(uint256 nodeOperatorId) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.value == e2.msg.value;

    safeAssumptions_NOS(nodeOperatorId);
    activateNodeOperator(e1, nodeOperatorId);
    deactivateNodeOperator@withrevert(e2, nodeOperatorId);

    assert !lastReverted;
}

rule canActivateAfterDeactivate(uint256 nodeOperatorId) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.value == e2.msg.value;

    safeAssumptions_NOS(nodeOperatorId);
    deactivateNodeOperator(e1, nodeOperatorId);
    activateNodeOperator@withrevert(e2, nodeOperatorId);

    assert !lastReverted;
}

rule cannotFinalizeUpgradeTwice() {
    env e1;
    env e2;
    calldataarg args1;
    calldataarg args2;
    finalizeUpgrade_v2(e1, args1);
    finalizeUpgrade_v2@withrevert(e2, args2);
    assert lastReverted;
}

rule sumOfRewardsSharesEqualsTotalShares(uint256 totalRewardShares) {
    env e;
    uint256 sumOfShares;
    uint256 _share;

    require getNodeOperatorsCount() > 0;
    require getNodeOperatorIsActive(0);
    require getNodeOperatorIsActive(1);
    requireInvariant ExitedKeysLEDepositedKeys(0);
    requireInvariant ExitedKeysLEDepositedKeys(1);
    require getNodeOperatorSigningStats_deposited(0) < 10000;
    require getNodeOperatorSigningStats_deposited(1) < 10000;

    sumOfShares, _share = getRewardsDistributionShare(e, totalRewardShares, 0);
    assert sumOfShares == totalRewardShares;
}

rule rewardSharesAreMonotonicWithTotalShares(
    uint256 nodeOperatorId, 
    uint256 totalRewardShares1, 
    uint256 totalRewardShares2) {

    env e;
    require totalRewardShares2 == totalRewardShares1 + 1;
    //require totalRewardShares2 > totalRewardShares1;
    uint256 sumOfShares1; uint256 sumOfShares2;
    uint256 share1; uint256 share2;

    require getNodeOperatorsCount() > 0;
    require getNodeOperatorIsActive(0);
    require getNodeOperatorIsActive(1);
    requireInvariant ExitedKeysLEDepositedKeys(0);
    requireInvariant ExitedKeysLEDepositedKeys(1);
    require getNodeOperatorSigningStats_deposited(0) < 10000;
    require getNodeOperatorSigningStats_deposited(1) < 10000;
    
    sumOfShares1, share1 = getRewardsDistributionShare(e, totalRewardShares1, nodeOperatorId);
    sumOfShares2, share2 = getRewardsDistributionShare(e, totalRewardShares2, nodeOperatorId);

    //assert sumOfShares2 > sumOfShares1;
    assert share2 >= share1;
}
