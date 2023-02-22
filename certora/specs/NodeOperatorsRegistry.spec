import "./NodeRegistryMethods.spec"

methods {
    getNodeOperatorsCount() returns (uint256) envfree
    getActiveNodeOperatorsCount() returns (uint256) envfree
    MAX_NODE_OPERATORS_COUNT() returns (uint256) envfree

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
 *                  Invariants                    *
 **************************************************/
invariant NodeOperatorsCountLEMAX()
    getNodeOperatorsCount() <= MAX_NODE_OPERATORS_COUNT()

invariant ActiveOperatorsLECount()
    getActiveNodeOperatorsCount() <= getNodeOperatorsCount()
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
        }
    }

invariant ExitedKeysLEDepositedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_exited(nodeOperatorId) <=
    getNodeOperatorSigningStats_deposited(nodeOperatorId)
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
        }
    }

invariant DepositedKeysLEVettedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_deposited(nodeOperatorId) <=
    getNodeOperatorSigningStats_vetted(nodeOperatorId)
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
        }
    }

invariant VettedKeysLETotalKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_vetted(nodeOperatorId) <=
    getNodeOperatorSigningStats_total(nodeOperatorId)
    {
        preserved {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
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
    requireInvariant NodeOperatorsCountLEMAX();
    requireInvariant ActiveOperatorsLECount();
    addNodeOperator(e1, name, rewardAddress);

    deactivateNodeOperator@withrevert(e2, nodeOperatorId);
    assert !lastReverted;
 }

 rule canDeactivateAfterActivate(uint256 nodeOperatorId) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.value == e2.msg.value;

    requireInvariant NodeOperatorsCountLEMAX();
    requireInvariant ActiveOperatorsLECount();
    activateNodeOperator(e1, nodeOperatorId);
    deactivateNodeOperator@withrevert(e2, nodeOperatorId);

    assert !lastReverted;
}

rule canActivateAfterDeactivate(uint256 nodeOperatorId) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.value == e2.msg.value;

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
