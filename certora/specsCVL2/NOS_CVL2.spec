using NodeOperatorsRegistryHarness as nos;

methods {
    // LidoLocator
    function _.getLocator() external => NONDET;
    function _.lido() external => NONDET;
    function _.burner() external => NONDET;

    // NodeOperatorsRegistry
    function nos._canPerformNoParams(address sender, bytes32 role) internal returns(bool) => canPerformNoParams(sender, role);
    function nos.canPerform(address, bytes32, uint256[]) external returns(bool) => ALWAYS(true);
    function nos.loadKeysHelper() external returns (uint256) envfree; 

    // StEth
    function _.sharesOf(address) external => DISPATCHER(true);
    function _.transferShares(address, uint256) external => DISPATCHER(true);
    function _.approve(address, uint256) external => DISPATCHER(true);
    function _.transferSharesFrom(address, address, uint256) external => DISPATCHER(true);

    // Burner
    function _.requestBurnShares(address, uint256) external => DISPATCHER(true);

    function getNodeOperatorsCount() external returns (uint256) envfree;
    function getActiveNodeOperatorsCount() external returns (uint256) envfree;
    function getNodeOperatorIsActive(uint256) external returns (bool) envfree;
    function MAX_NODE_OPERATORS_COUNT() external returns (uint256) envfree;
    function getRewardsDistributionShare(uint256, uint256) external returns (uint256, uint256);
    function getStakingModuleSummary() external returns (uint256,uint256,uint256) envfree;
    function getStuckPenaltyDelay() external returns(uint256) envfree;
    function getSigningKeysAllocationDataPerNode(uint256,uint256) external returns(uint256,uint256,uint256) envfree;

    /// Node operator registry summary of node operators
    function getSummaryTotalExitedValidators() external returns (uint256) envfree;
    function getSummaryTotalDepositedValidators() external returns (uint256) envfree;
    function getSummaryTotalKeyCount() external returns (uint256) envfree;
    function getSummaryMaxValidators() external returns (uint256) envfree;
    /// Stuck keys stats per NodeOperator
    function getNodeOperator_stuckValidators(uint256) external returns (uint256) envfree;
    function getNodeOperator_refundedValidators(uint256) external returns (uint256) envfree;
    function getNodeOperator_endTimeStamp(uint256) external returns (uint256) envfree;
    /// Signing stats per NodeOperator
    function getNodeOperatorSigningStats_exited(uint256) external returns (uint256) envfree;
    function getNodeOperatorSigningStats_vetted(uint256) external returns (uint256) envfree;
    function getNodeOperatorSigningStats_deposited(uint256) external returns (uint256) envfree;
    function getNodeOperatorSigningStats_total(uint256) external returns (uint256) envfree;
    /// Target stats per NodeOperator
    function getNodeOperatorTargetStats_target(uint256) external returns (uint256) envfree;
    function getNodeOperatorTargetStats_max(uint256) external returns (uint256) envfree;
    /// Sum of keys 
    function sumOfExitedKeys() external returns (uint256) envfree;
    function sumOfDepositedKeys() external returns (uint256) envfree;
    function sumOfTotalKeys() external returns (uint256) envfree;
    function sumOfMaxKeys() external returns (uint256) envfree;
    function sumOfActiveOperators() external returns (uint256) envfree;
}

function canPerformNoParams(address sender, bytes32 role) returns bool {
    return canPerformGhost[sender][role];
}

ghost mapping(address => mapping(bytes32 => bool)) canPerformGhost;

definition UINT64_MAX() returns uint256 = 0xFFFFFFFFFFFFFFFF;
definition UINT32_MAX() returns uint256 = 0xFFFFFFFF;

/**************************************************
 *                  Methods definitions           *
 **************************************************/

definition isFinalizeUpgrade(method f) returns bool = 
    f.selector == sig:finalizeUpgrade_v2(address, bytes32, uint256).selector;

definition isObtainDepData(method f) returns bool = 
    f.selector == sig:obtainDepositData(uint256, bytes).selector;

definition isAddSignKeys(method f) returns bool = 
    f.selector == sig:addSigningKeys(uint256, uint256, bytes, bytes).selector;

definition isInvalidateUnused(method f) returns bool = 
    f.selector == sig:onWithdrawalCredentialsChanged().selector ||
    f.selector == sig:invalidateReadyToDepositKeysRange(uint256,uint256).selector;

definition methodsDontChangeKeys(method f) returns bool = 
    f.selector == sig:initialize(address,bytes32,uint256).selector ||
    f.selector == sig:removeSigningKey(uint256,uint256).selector ||
    f.selector == sig:transferToVault(address).selector ||
    f.selector == sig:setNodeOperatorName(uint256,string).selector ||
    f.selector == sig:removeSigningKeysOperatorBH(uint256,uint256,uint256).selector ||
    f.selector == sig:setNodeOperatorRewardAddress(uint256,address).selector ||
    f.selector == sig:removeSigningKeyOperatorBH(uint256,uint256).selector ||
    f.selector == sig:addNodeOperator(string,address).selector ||
    f.selector == sig:addSigningKeysOperatorBH(uint256,uint256,bytes,bytes).selector ||
    f.selector == sig:onExitedAndStuckValidatorsCountsUpdated().selector ||
    f.selector == sig:setStuckPenaltyDelay(uint256).selector || 
    f.selector == sig:activateNodeOperator(uint256).selector;

/**************************************************
 *                 Invariants Helpers             *
 **************************************************/
/// Makes sure that if there are any inactive operators, then the sum of active operators
/// is strictly less than the sum of all operators accordingly.
function activeOperatorsSumHelper(uint256 id1, uint256 id2) {
    require (id1 != id2 && !getNodeOperatorIsActive(id1) && !getNodeOperatorIsActive(id2)
    && id1 < getNodeOperatorsCount() && id2 < getNodeOperatorsCount()) => 
        require_uint256(getActiveNodeOperatorsCount() + 2) <= getNodeOperatorsCount();

    require (id1 == id2 && !getNodeOperatorIsActive(id1) && id1 < getNodeOperatorsCount()) =>
        require_uint256(getActiveNodeOperatorsCount() + 1) <= getNodeOperatorsCount();
}

/// A list of safe assumptions for the NOS contract to be used in rules/ other invariants
/// These safe assumptions rely on the correctness of verified invariants inside this block.
function safeAssumptions_NOS(uint256 nodeOperatorId) {
    requireInvariant NodeOperatorsCountLEMAX();
    requireInvariant ActiveOperatorsLECount();
    requireInvariant SumOfActiveOperatorsEqualsActiveCount();
    requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
    requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
    requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
    requireInvariant VettedKeysLETotalKeys(nodeOperatorId);
    requireInvariant TargetPlusExitedDoesntOverflow(nodeOperatorId);
    requireInvariant KeysOfUnregisteredNodeAreZero(nodeOperatorId);
    requireInvariant DepositedKeysLEMaxValidators(nodeOperatorId);
    requireInvariant VettedKeysGEMaxValidators(nodeOperatorId);
    requireInvariant NoDepositableKeysForInactiveModule(nodeOperatorId);
    requireInvariant StuckPlusExitedLEDeposited(nodeOperatorId);
    reasonableKeysAssumptions(nodeOperatorId);
}

/// A reasonable assumption about the number of keys for each node operator
/// Used to prevent unrealistic overflows.
/// Note : UINT32_MAX() = 2^32 - 1 ~ 4.3e9 (= 4.3 billion)
function reasonableKeysAssumptions(uint256 nodeOperatorId) {
    require getNodeOperatorSigningStats_total(nodeOperatorId) <= UINT32_MAX();
    require getSummaryTotalKeyCount() <= UINT32_MAX();
    require getSummaryMaxValidators() <= UINT32_MAX();
    require getSummaryTotalDepositedValidators() <= UINT32_MAX();
    require getSummaryTotalExitedValidators() <= UINT32_MAX();
    require getNodeOperatorTargetStats_target(nodeOperatorId) <= UINT64_MAX();
}

/**************************************************
 *                  Invariants                    *
 **************************************************/
/// The number of node operators is always bounded by the max value allowed.
invariant NodeOperatorsCountLEMAX()
    getNodeOperatorsCount() <= MAX_NODE_OPERATORS_COUNT();

/// The number of active node operators is always less or equal to the total number of operators.
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
/// If the active operators count is equal to the total operatos count,
/// then every operator must be active (whose id is less than the count). 
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
/// The sum of all active node operators equals the active count.
invariant SumOfActiveOperatorsEqualsActiveCount() 
    sumOfActiveOperators() == getActiveNodeOperatorsCount();

/// Any unregistered node operator is not penalized
invariant UnregisteredOperatorIsNotPenalized(env e, uint256 nodeOperatorId)
    (e.block.timestamp > 0 && nodeOperatorId >= getNodeOperatorsCount())
    => !isOperatorPenalized(e, nodeOperatorId)
    {
        preserved {
            safeAssumptions_NOS(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e2)
        {
            require e2.block.timestamp == e.block.timestamp;
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }
/// The exited keys count is never higher than the deposited keys count
invariant ExitedKeysLEDepositedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_exited(nodeOperatorId) <=
    getNodeOperatorSigningStats_deposited(nodeOperatorId)
    {
        preserved{
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }

/// The deposited keys count is never higher than the vetted keys count
invariant DepositedKeysLEVettedKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_deposited(nodeOperatorId) <=
    getNodeOperatorSigningStats_vetted(nodeOperatorId)
    {
        preserved{
            safeAssumptions_NOS(nodeOperatorId);
        }

        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }

/// The vetted keys count is never higher than the total keys count
invariant VettedKeysLETotalKeys(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_vetted(nodeOperatorId) <=
    getNodeOperatorSigningStats_total(nodeOperatorId)
    {
        preserved {
            requireInvariant NodeOperatorsCountLEMAX();
            requireInvariant ExitedKeysLEDepositedKeys(nodeOperatorId);
            requireInvariant DepositedKeysLEVettedKeys(nodeOperatorId);
        }

        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }
/// The vetted keys count is never less than the max validators target
invariant VettedKeysGEMaxValidators(uint256 nodeOperatorId)
    getNodeOperatorTargetStats_max(nodeOperatorId) <=
    getNodeOperatorSigningStats_vetted(nodeOperatorId)
    {
        preserved {
            safeAssumptions_NOS(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            safeAssumptions_NOS(nodeOperatorId);
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }

/// The deposited keys count is never higher than the max validators target 
invariant DepositedKeysLEMaxValidators(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_deposited(nodeOperatorId) <=
    getNodeOperatorTargetStats_max(nodeOperatorId)
    {
        preserved {
            safeAssumptions_NOS(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }

/// All key counts of an unregistered node operators are zero
invariant KeysOfUnregisteredNodeAreZero(uint256 nodeOperatorId) 
    nodeOperatorId >= getNodeOperatorsCount() =>
    (getNodeOperatorSigningStats_total(nodeOperatorId) == 0 &&
    getNodeOperatorSigningStats_vetted(nodeOperatorId) == 0 &&
    getNodeOperatorSigningStats_deposited(nodeOperatorId) == 0 &&
    getNodeOperatorSigningStats_exited(nodeOperatorId) == 0 &&
    getNodeOperatorTargetStats_max(nodeOperatorId) == 0 &&
    getNodeOperator_refundedValidators(nodeOperatorId) == 0 &&
    getNodeOperator_stuckValidators(nodeOperatorId) == 0)
    {
        preserved{
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }

/// Required for preventing unexpected reverts.
invariant TargetPlusExitedDoesntOverflow(uint256 nodeOperatorId)
    getNodeOperatorSigningStats_exited(nodeOperatorId) +
    getNodeOperatorTargetStats_target(nodeOperatorId) <= to_mathint(2*max_uint64)
    {
        preserved{
            requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
            requireInvariant ActiveOperatorsLECount();
            requireInvariant NodeOperatorsCountLEMAX();
            reasonableKeysAssumptions(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(uint256 indexFrom, uint256 indexTo) with (env e)
        {
            safeAssumptions_NOS(nodeOperatorId);
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }
/// Any deactivated node operator has no depositable keys (max validators = deposited = vetted)
invariant NoDepositableKeysForInactiveModule(uint256 nodeOperatorId)    
    !getNodeOperatorIsActive(nodeOperatorId) => (
        getNodeOperatorSigningStats_deposited(nodeOperatorId) ==
        getNodeOperatorTargetStats_max(nodeOperatorId) && 
        getNodeOperatorSigningStats_deposited(nodeOperatorId) ==
        getNodeOperatorSigningStats_vetted(nodeOperatorId))
    {
        preserved 
        {
            safeAssumptions_NOS(nodeOperatorId);
        }
        preserved invalidateReadyToDepositKeysRange(
            uint256 indexFrom, uint256 indexTo) with (env e)
        {
            safeAssumptions_NOS(nodeOperatorId);
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
    }
/// The sum of stuck validators plus exited must be less or equal to the deposited keys count.
invariant StuckPlusExitedLEDeposited(uint256 nodeOperatorId)
    to_mathint(getNodeOperatorSigningStats_exited(nodeOperatorId) +
    getNodeOperator_stuckValidators(nodeOperatorId)) <=
    to_mathint(getNodeOperatorSigningStats_deposited(nodeOperatorId))
    {
        preserved invalidateReadyToDepositKeysRange(
            uint256 indexFrom, uint256 indexTo) with (env e) 
        {
            safeAssumptions_NOS(nodeOperatorId);
            require indexFrom == nodeOperatorId;
            require indexTo == nodeOperatorId;
        }
        preserved {
            safeAssumptions_NOS(nodeOperatorId);
        }
    }
/// Penalty is always considered 'cleared' for an unregistered module.
invariant PenaltyClearedForUnregistered(env e, uint256 nodeOperatorId)
    (nodeOperatorId >= getNodeOperatorsCount() && e.block.timestamp > 0) => isOperatorPenaltyCleared(e, nodeOperatorId)
    {
        preserved with (env e0){
            require e0.block.timestamp == e.block.timestamp;
        }
    }
/**************************************************
 *          Keys summaries - sums invariants     *
**************************************************/
/// See 'sumOfKeysEqualsSummary' rule below.

/// The sum of all deposited keys from all operators is equal to the summary.
invariant SumOfDepositedKeysEqualsSummary()
    sumOfDepositedKeys() == getSummaryTotalDepositedValidators()
    {
        preserved {
            safeAssumptions_NOS(0);
            safeAssumptions_NOS(1);
            //require getNodeOperatorSigningStats_deposited(0) <= getSummaryTotalDepositedValidators();
            //require getNodeOperatorSigningStats_deposited(1) <= getSummaryTotalDepositedValidators();
            //require getNodeOperatorSigningStats_deposited(2) <= getSummaryTotalDepositedValidators();
        }
    }

/// The sum of all exited keys from all operators is equal to the summary.
invariant SumOfExitedKeysEqualsSummary()
    sumOfExitedKeys() == getSummaryTotalExitedValidators()
    {
        preserved {
            safeAssumptions_NOS(0);
            safeAssumptions_NOS(1);
            //require getNodeOperatorSigningStats_exited(0) <= getSummaryTotalExitedValidators();
            //require getNodeOperatorSigningStats_exited(1) <= getSummaryTotalExitedValidators();
            //require getNodeOperatorSigningStats_exited(2) <= getSummaryTotalExitedValidators();
        }
    }

/// The sum of all keys from all operators is equal to the summary.
invariant SumOfTotalKeysEqualsSummary()
    sumOfTotalKeys() == getSummaryTotalKeyCount()
    {
        preserved {
            safeAssumptions_NOS(0);
            safeAssumptions_NOS(1);
            //require getNodeOperatorSigningStats_total(0) <= getSummaryTotalKeyCount();
            //require getNodeOperatorSigningStats_total(1) <= getSummaryTotalKeyCount();
            //require getNodeOperatorSigningStats_total(2) <= getSummaryTotalKeyCount();
        }
    }

/// The sum of all target max keys from all operators is equal to the summary.
invariant SumOfMaxKeysEqualsSummary()
    sumOfMaxKeys() == getSummaryMaxValidators()
    {
        preserved {
            safeAssumptions_NOS(0);
            safeAssumptions_NOS(1);
            //require getNodeOperatorTargetStats_max(0) <= getSummaryMaxValidators();
            //require getNodeOperatorTargetStats_max(1) <= getSummaryMaxValidators();
            //require getNodeOperatorTargetStats_max(2) <= getSummaryMaxValidators();
        }
    }

/**************************************************
 *          Sum of keys equals summary            *
**************************************************/
rule whichFunctionsChangeKeys(uint256 nodeOperatorId, method f) 
filtered{f -> !f.isView}{
    env e;
    calldataarg args;
    uint256 stuck_before = getNodeOperator_stuckValidators(nodeOperatorId);
    uint256 exited_before = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 deposited_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 total_before = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 max_before = getNodeOperatorTargetStats_max(nodeOperatorId);
        f(e, args);
    uint256 stuck_after = getNodeOperator_stuckValidators(nodeOperatorId);
    uint256 exited_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 max_after = getNodeOperatorTargetStats_max(nodeOperatorId);

    bool KeyCountDontChange = (
        stuck_after == stuck_before &&
        exited_after == exited_before && 
        deposited_after == deposited_before &&
        total_after == total_before && 
        max_after == max_before);

    assert methodsDontChangeKeys(f) => KeyCountDontChange;
}

rule keyCountChangesTogetherWithSummary(method f) 
filtered{f -> !f.isView && !isFinalizeUpgrade(f)} {
    env e;
    calldataarg args;
    safeAssumptions_NOS(0);
    require getNodeOperatorsCount() <= 1;
    ///
    uint256 sum_exited_before = sumOfExitedKeys();
    uint256 sum_deposited_before = sumOfDepositedKeys();
    uint256 sum_total_before = sumOfTotalKeys();
    uint256 sum_max_before = sumOfMaxKeys();
    ///
    uint256 summary_exited_before = getSummaryTotalExitedValidators();
    uint256 summary_deposited_before = getSummaryTotalDepositedValidators();
    uint256 summary_total_before = getSummaryTotalKeyCount();
    uint256 summary_max_before = getSummaryMaxValidators();
    ///
    /// See cannotClearPenaltyForUnRegisteredOperators
    if(f.selector == sig:clearNodeOperatorPenalty(uint256).selector) {
        uint256 nodeOperatorId;
        require nodeOperatorId < getNodeOperatorsCount();
        clearNodeOperatorPenalty(e, nodeOperatorId);
    }
    else if(f.selector == sig:addNodeOperator(string,address).selector) {
        requireInvariant KeysOfUnregisteredNodeAreZero(getNodeOperatorsCount());
        addNodeOperator(e, args);
    }
    else {
        f(e, args);
    }
    ///
    uint256 sum_exited_after = sumOfExitedKeys();
    uint256 sum_deposited_after = sumOfDepositedKeys();
    uint256 sum_total_after = sumOfTotalKeys();
    uint256 sum_max_after  = sumOfMaxKeys();
    ///
    uint256 summary_exited_after = getSummaryTotalExitedValidators();
    uint256 summary_deposited_after = getSummaryTotalDepositedValidators();
    uint256 summary_total_after = getSummaryTotalKeyCount();
    uint256 summary_max_after = getSummaryMaxValidators();
    ///

    bool KeyCountChanged = !(
        sum_exited_before == sum_exited_after && 
        sum_deposited_after == sum_deposited_before &&
        sum_total_after == sum_total_before && 
        sum_max_after == sum_max_before);

    bool SummaryChanged = !(
        summary_exited_after == summary_exited_before && 
        summary_deposited_after == summary_deposited_before &&
        summary_total_after == summary_total_before && 
        summary_max_after == summary_max_before);

    assert SummaryChanged <=> KeyCountChanged;
}

/// An alternative rule for checking the four invariants of summary equals sum
/// of keys over all node operators.
/// @notice : we assume exactly one node operator (nodeOperatorId) whose keys are changed.
rule sumOfKeysEqualsSummary(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView && !methodsDontChangeKeys(f)} {
    env e;
    calldataarg args;
    safeAssumptions_NOS(nodeOperatorId);
    ///
    uint256 exited_before = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 deposited_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 total_before = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 max_before = getNodeOperatorTargetStats_max(nodeOperatorId);
    ///
    uint256 summary_exited_before = getSummaryTotalExitedValidators();
    uint256 summary_deposited_before = getSummaryTotalDepositedValidators();
    uint256 summary_total_before = getSummaryTotalKeyCount();
    uint256 summary_max_before = getSummaryMaxValidators();
    ///

    /// If the summary is assumed to be equal to the sum, then every individual key count
    /// equals at most to the corresponding summary.
    require exited_before <= summary_exited_before;
    require deposited_before <= summary_deposited_before;
    require total_before <= summary_total_before;
    require max_before <= summary_max_before;
    
    if(isFinalizeUpgrade(f)) {
        require getSummaryTotalDepositedValidators() == 0;
        require getSummaryTotalExitedValidators() == 0;
        require getSummaryTotalKeyCount() == 0;
        require getSummaryMaxValidators() == 0;
    }
    else if(isInvalidateUnused(f)) {
        invalidateReadyToDepositKeysRange(e, nodeOperatorId, nodeOperatorId);
    }
    else {
        f(e, args);
    }

    ///
    uint256 exited_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 max_after = getNodeOperatorTargetStats_max(nodeOperatorId);
    ///
    uint256 summary_exited_after = getSummaryTotalExitedValidators();
    uint256 summary_deposited_after = getSummaryTotalDepositedValidators();
    uint256 summary_total_after = getSummaryTotalKeyCount();
    uint256 summary_max_after = getSummaryMaxValidators();
    ///

    bool KeyCountChanged = !(
        exited_after == exited_before && 
        deposited_after == deposited_before &&
        total_after == total_before && 
        max_after == max_before);

    /// Assume change in at least one of the key types for 'nodeOperatorId'
    require !isFinalizeUpgrade(f) => KeyCountChanged;

    // assert invariants (assert if delta of summary equals delta of sum)
    assert summary_exited_after + exited_before == 
        summary_exited_before + exited_after , 
        "Summary of exited keys doesn't equal to sum of keys";

    assert summary_deposited_after + deposited_before == 
        summary_deposited_before + deposited_after , 
        "Summary of deposited keys doesn't equal to sum of keys";
    
    assert summary_total_after + total_before == 
        summary_total_before + total_after , 
        "Summary of total keys doesn't equal to sum of keys";

    assert summary_max_after + max_before ==
        summary_max_before + max_after ,
        "Summary of max target keys doesn't equal to sum of keys";
}

/**************************************************
 *        Revert characteristics       *
 **************************************************/

 rule canAlwaysDeactivateAddedNodeOperator(method f) 
 filtered{f -> !f.isView && f.selector != sig:deactivateNodeOperator(uint256).selector} {
    env e1;
    env e2;
    env e3;
    calldataarg args;
    require e1.msg.sender == e3.msg.sender;
    require e3.msg.value == 0;

    string name;
    address rewardAddress;
    uint256 nodeOperatorId = getNodeOperatorsCount();

    requireInvariant AllModulesAreActiveConsistency(nodeOperatorId);
    addNodeOperator(e1, name, rewardAddress);
    safeAssumptions_NOS(0);
    safeAssumptions_NOS(1);
    require getNodeOperatorsCount() <= 2;
    requireInvariant SumOfTotalKeysEqualsSummary();
    requireInvariant SumOfMaxKeysEqualsSummary();

    f(e2, args);

    deactivateNodeOperator@withrevert(e3, nodeOperatorId);
    assert !lastReverted;
 }

 rule canDeactivateAfterActivate(method f, uint256 nodeOperatorId)
 filtered{f -> !f.isView && f.selector != sig:deactivateNodeOperator(uint256).selector} {
    env e1;
    env e2;
    env e3;
    calldataarg args;
    require e1.msg.sender == e3.msg.sender;
    require e3.msg.value == 0;

    safeAssumptions_NOS(nodeOperatorId);
    activateNodeOperator(e1, nodeOperatorId);
    
    f(e2, args);

    deactivateNodeOperator@withrevert(e3, nodeOperatorId);

    assert !lastReverted;
}

rule canActivateAfterDeactivate(method f, uint256 nodeOperatorId)
filtered{f -> !f.isView && f.selector != sig:activateNodeOperator(uint256).selector} {
    env e1;
    env e2;
    env e3;
    calldataarg args;
    require e1.msg.sender == e3.msg.sender;
    require e3.msg.value == 0;

    safeAssumptions_NOS(nodeOperatorId);
    deactivateNodeOperator(e1, nodeOperatorId);

    f(e2, args);
    
    activateNodeOperator@withrevert(e3, nodeOperatorId);

    assert !lastReverted;
}

/// cannot call finalize upgrade twice
rule cannotFinalizeUpgradeTwice(method f) 
filtered {f -> !isFinalizeUpgrade(f) && !f.isView} {
    env e1;
    env e2;
    env e3;
    calldataarg args1;
    calldataarg args2;
    calldataarg args3;
    finalizeUpgrade_v2(e1, args1);
    f(e2, args2);
    finalizeUpgrade_v2@withrevert(e3, args3);
    assert lastReverted;
}
/// Only deactivateNodeOperator deactivates a node operator [VERIFIED]
rule whoDeactivatesNodeOperators(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 otherId; require nodeOperatorId != otherId;

    bool active_before = getNodeOperatorIsActive(nodeOperatorId);
    bool other_active_before = getNodeOperatorIsActive(otherId);
        f(e, args);
    bool active_after = getNodeOperatorIsActive(nodeOperatorId);
    bool other_active_after = getNodeOperatorIsActive(otherId);

    assert (active_before && !active_after) =>
        f.selector == sig:deactivateNodeOperator(uint256).selector;

    /// Assert that the active status doesn't change for any other node operator.
    assert (active_before && !active_after) =>
        (other_active_before == other_active_after);
}

/// cannot call initialize twice
rule cannotInitializeTwice(method f) 
filtered {f -> f.selector != sig:initialize(address,bytes32,uint256).selector && !f.isView} {
    env e1;
    env e2;
    env e3;
    calldataarg args1;
    calldataarg args2;
    calldataarg args3;
    require e1.block.number > 0;
    require e2.block.number > 0;
    require e3.block.number > 0;
    initialize(e1, args1);
    f(e2, args2);
    initialize@withrevert(e3, args3);
    assert lastReverted;
}

rule sumOfRewardsSharesLETotalShares(uint256 totalRewardShares) {
    env e;
    uint256 sumOfShares;
    uint256 share;

    sumOfShares, share = getRewardsDistributionShare(e, totalRewardShares, 0);
    assert sumOfShares <= totalRewardShares;
}

rule rewardSharesAreMonotonicWithTotalShares(
    uint256 nodeOperatorId, 
    uint256 totalRewardShares1, 
    uint256 totalRewardShares2) {

    env e;
    require totalRewardShares2 == require_uint256(totalRewardShares1 + 1);
    uint256 sumOfShares1; uint256 sumOfShares2;
    uint256 share1; uint256 share2;

    //safeAssumptions_NOS(0);
    //safeAssumptions_NOS(1);
    safeAssumptions_NOS(nodeOperatorId);
    requireInvariant SumOfActiveOperatorsEqualsActiveCount();
    
    sumOfShares1, share1 = getRewardsDistributionShare(e, totalRewardShares1, nodeOperatorId);
    sumOfShares2, share2 = getRewardsDistributionShare(e, totalRewardShares2, nodeOperatorId);

    assert sumOfShares2 >= sumOfShares1;
    assert share2 >= share1;
}

/**************************************************
 *    Node Operator SigningStats change rules     *
**************************************************/

rule exitedKeysDontDecrease(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    
    safeAssumptions_NOS(nodeOperatorId);

    uint256 exited_before = getNodeOperatorSigningStats_exited(nodeOperatorId);
    require exited_before <= UINT32_MAX();
    requireInvariant UnregisteredOperatorIsNotPenalized(e, nodeOperatorId);
        
    if(f.selector == sig:unsafeUpdateValidatorsCount(uint256,uint256,uint256).selector){
        uint256 _exitedValidatorsCount; 
        require _exitedValidatorsCount <= UINT32_MAX();
        uint256 _stuckValidatorsCount;
        unsafeUpdateValidatorsCount(e, nodeOperatorId, _exitedValidatorsCount, _stuckValidatorsCount);
        uint256 exited_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
        assert exited_before < _exitedValidatorsCount => exited_before < exited_after;
    }
    else if(isInvalidateUnused(f)){
        invalidateReadyToDepositKeysRange(e, nodeOperatorId, nodeOperatorId);
        uint256 exited_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
        assert exited_before <= exited_after;
    }
    else {
        f(e, args);
        uint256 exited_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
        assert exited_before <= exited_after;
    }
}

rule exitedKeysChangeForOnlyOneNodeOperator(method f, uint256 nodeOperatorId1) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 nodeOperatorId2;
    safeAssumptions_NOS(nodeOperatorId1);
    safeAssumptions_NOS(nodeOperatorId2);
    
    uint256 exited_before_1 = getNodeOperatorSigningStats_exited(nodeOperatorId1);
    uint256 exited_before_2 = getNodeOperatorSigningStats_exited(nodeOperatorId2);
    if(isInvalidateUnused(f)){
        invalidateReadyToDepositKeysRange(e, nodeOperatorId1, nodeOperatorId1);
    }
    else{
        f(e, args);}
    uint256 exited_after_1 = getNodeOperatorSigningStats_exited(nodeOperatorId1);
    uint256 exited_after_2 = getNodeOperatorSigningStats_exited(nodeOperatorId2);

    assert (exited_before_1 != exited_after_1 && exited_before_2 != exited_after_2) 
        => (nodeOperatorId1 == nodeOperatorId2 || 
        f.selector == sig:updateExitedValidatorsCount(bytes,bytes).selector);
}

rule depositedKeysDontDecrease(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 deposited_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
        if(isInvalidateUnused(f)){
            invalidateReadyToDepositKeysRange(e, nodeOperatorId, nodeOperatorId);}
        else{
            f(e, args);}
    uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    assert deposited_before <= deposited_after;
}

/// @notice : we filter out 'loadAllocatedSigningKeys' as it is an artificial method, 
/// a part of obtainDepositData.
rule depositedKeysDontChangeByOtherFunctions(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView && !isObtainDepData(f) && 
        f.selector != sig:loadAllocatedSigningKeys(uint256).selector} {
    env e;
    calldataarg args;
    uint256 deposited_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
        if(isInvalidateUnused(f)){
            invalidateReadyToDepositKeysRange(e, nodeOperatorId, nodeOperatorId);}
        else{
            f(e, args);}
    uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);

    assert (deposited_before == deposited_after);
}

rule totalKeysChangeIntegrity(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 total_before = getNodeOperatorSigningStats_total(nodeOperatorId);

    if(f.selector == sig:addSigningKeys(uint256,uint256,bytes,bytes).selector) {
        bytes publicKeys;
        bytes signatures;
        uint256 keysCount;
        addSigningKeys(e, nodeOperatorId, keysCount, publicKeys, signatures);
        uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);

        assert total_after == require_uint256(total_before + keysCount);
    }
    else if(f.selector == sig:removeSigningKeys(uint256,uint256,uint256).selector) {
        uint256 index_from;
        uint256 keysCount;
        removeSigningKeys(e, nodeOperatorId, index_from, keysCount);
        uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);

        assert to_mathint(total_after) == total_before - keysCount;
    }
    else if( isInvalidateUnused(f) ) {
        invalidateReadyToDepositKeysRange(e, nodeOperatorId, nodeOperatorId);
        uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
        uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);
        assert total_after == deposited_after;
    }   
    else {
        f(e, args);
        uint256 total_after = getNodeOperatorSigningStats_total(nodeOperatorId);
        assert total_before == total_after;
    }
}

rule totalKeysChangeForOnlyOneNodeOperator(method f, uint256 nodeOperatorId1) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint256 nodeOperatorId2;
    uint256 total_before_1 = getNodeOperatorSigningStats_total(nodeOperatorId1);
    uint256 total_before_2 = getNodeOperatorSigningStats_total(nodeOperatorId2);
        if(isInvalidateUnused(f)){
            invalidateReadyToDepositKeysRange(e, nodeOperatorId1, nodeOperatorId1);}
        else{
            f(e, args);}
    uint256 total_after_1 = getNodeOperatorSigningStats_total(nodeOperatorId1);
    uint256 total_after_2 = getNodeOperatorSigningStats_total(nodeOperatorId2);

    assert (total_before_1 != total_after_1 && total_before_2 != total_after_2) 
        => nodeOperatorId1 == nodeOperatorId2;
}

rule maxValidatorsChangeForOnlyOneNodeOperator(method f, uint256 nodeOperatorId1) 
filtered{f -> !f.isView && !isFinalizeUpgrade(f) && !isObtainDepData(f)} {
    env e;
    calldataarg args;
    uint256 nodeOperatorId2;
    uint256 max_before_1 = getNodeOperatorTargetStats_max(nodeOperatorId1);
    uint256 max_before_2 = getNodeOperatorTargetStats_max(nodeOperatorId2);
        if(isInvalidateUnused(f)){
            invalidateReadyToDepositKeysRange(e, nodeOperatorId1, nodeOperatorId1);
        }
        else{
            f(e, args);}
    uint256 max_after_1 = getNodeOperatorTargetStats_max(nodeOperatorId1);
    uint256 max_after_2 = getNodeOperatorTargetStats_max(nodeOperatorId2);

    assert ((max_before_1 != max_after_1 && max_before_2 != max_after_2) 
        => nodeOperatorId1 == nodeOperatorId2) ||
        f.selector == sig:updateExitedValidatorsCount(bytes,bytes).selector ||
        f.selector == sig:updateStuckValidatorsCount(bytes,bytes).selector;
}

/**************************************************
 *    Node Operator obtainDepositData           *
**************************************************/
/// The function should never revert for a valid deposit count input.
/// and revert if the deposit count is larger than the depositable amount.
rule obtainDepositDataDoesntRevert(uint256 depositsCount) {
    env e; require e.msg.value ==0;
    uint256 totalExited; uint256 totalDeposited; uint256 depositable;
    totalExited, totalDeposited, depositable = getStakingModuleSummary();
    requireInvariant SumOfMaxKeysEqualsSummary();
    requireInvariant SumOfDepositedKeysEqualsSummary();
    requireInvariant SumOfExitedKeysEqualsSummary();
    require depositable <= UINT32_MAX();
    require totalExited <= totalDeposited;
    require totalDeposited + depositable <= to_mathint(UINT32_MAX());

    safeAssumptions_NOS(0);
    safeAssumptions_NOS(require_uint256(getNodeOperatorsCount()-1));

    require getActiveNodeOperatorsCount() > 0;

    /// If the deposits count is zero, the system doesn't call the deposit function
    /// inside Staking Router.
    require depositsCount > 0;
    uint256 allocated = nos.loadKeysHelper();
    require allocated == depositsCount;
    
    // Call again with an arbitraty depositCount
    loadAllocatedSigningKeys@withrevert(e, depositsCount);
    assert depositsCount <= depositable => !lastReverted;
}

rule signingKeysAllocationDataPerNodeBounded(uint256 depositsCount,uint256 index) {
    /// Require that the sum of keys equals the keys summary.
    requireInvariant SumOfMaxKeysEqualsSummary();
    requireInvariant SumOfDepositedKeysEqualsSummary();
    requireInvariant SumOfExitedKeysEqualsSummary();
    
    /// Fetch the keys summary
    uint256 totalExited; uint256 totalDeposited; uint256 depositable;
    totalExited, totalDeposited, depositable = getStakingModuleSummary();

    /// Get the allocation data per nodeOperator
    uint256 allocated; uint256 nodeOperatorId; uint256 allocationPerNode;
    allocated, nodeOperatorId, allocationPerNode = getSigningKeysAllocationDataPerNode(depositsCount, index);
    
    /// Fetch the keys of a specific nodeOperator
    safeAssumptions_NOS(nodeOperatorId);
    uint256 exited = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 max = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 deposited = getNodeOperatorSigningStats_deposited(nodeOperatorId);

    assert depositsCount <= depositable => allocated == depositsCount;
    assert to_mathint(allocationPerNode) <= max - exited;
    assert to_mathint(allocationPerNode) >= deposited - exited;
    assert !getNodeOperatorIsActive(nodeOperatorId) => allocationPerNode == 0;
}

/// Verifies that once a node operator is deactivated, it is left with no available keys.
rule afterDeactivateNoDepositableKeys(uint256 nodeOperatorId) {
    env e;
    safeAssumptions_NOS(nodeOperatorId);
    
    deactivateNodeOperator(e, nodeOperatorId);

    uint256 deposited = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 maxValidators = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 vetted = getNodeOperatorSigningStats_vetted(nodeOperatorId);

    assert deposited == maxValidators && deposited == vetted;
}

/**************************************************
 *  `invalidateReadyToDepositKeysRange` checks    *
**************************************************/
/// Checks the integrity of `invalidateReadyToDepositKeysRange` :
/// A node operator id not in the index range is not affected at all. 
rule invalidateReadyIndexIntegrity(uint256 nodeOperatorId, uint256 indexFrom, uint256 indexTo) {
    env e;
    uint256 exitedId_before = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 depositedId_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 vettedId_before = getNodeOperatorSigningStats_vetted(nodeOperatorId);
    uint256 totalId_before = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 maxId_before = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 refundedId_before = getNodeOperator_refundedValidators(nodeOperatorId);
    uint256 stuckId_before = getNodeOperator_stuckValidators(nodeOperatorId);
    uint256 endTimeStampId_before = getNodeOperator_endTimeStamp(nodeOperatorId);
        invalidateReadyToDepositKeysRange(e, indexFrom, indexTo);
    uint256 exitedId_after = getNodeOperatorSigningStats_exited(nodeOperatorId);
    uint256 depositedId_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    uint256 vettedId_after = getNodeOperatorSigningStats_vetted(nodeOperatorId);
    uint256 totalId_after = getNodeOperatorSigningStats_total(nodeOperatorId);
    uint256 maxId_after = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 refundedId_after = getNodeOperator_refundedValidators(nodeOperatorId);
    uint256 stuckId_after = getNodeOperator_stuckValidators(nodeOperatorId);
    uint256 endTimeStampId_after = getNodeOperator_endTimeStamp(nodeOperatorId);

    assert !(indexFrom <= nodeOperatorId && nodeOperatorId <= indexTo) => (
        (exitedId_before == exitedId_after) &&
        (depositedId_before == depositedId_after) &&
        (vettedId_before == vettedId_after) &&
        (totalId_before == totalId_after) &&
        (maxId_after == maxId_before) &&
        (refundedId_before == refundedId_after) &&
        (stuckId_before == stuckId_after) &&
        (endTimeStampId_before == endTimeStampId_after));
}

/**************************************************
 *          Stuck and Refunded Keys Logic         *
**************************************************/
/// Checks which functions change the penalty status.
rule penalizeStatusChange(method f, uint256 nodeOperatorId)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    bool penalized_before = isOperatorPenalized(e, nodeOperatorId);
    f(e, args);
    bool penalized_after = isOperatorPenalized(e, nodeOperatorId);

    assert f.selector == sig:clearNodeOperatorPenalty(uint256).selector =>
        penalized_before == penalized_after;
}

/// Checks that the penalty of nodeOperatorId is cleared.
/// Also checks that no other node operator changed its penalty status.
rule afterClearPenaltyOperatorIsNotPenalized(uint256 nodeOperatorId) {
    env e1;
    env e2;
    require e1.block.timestamp <= e2.block.timestamp;
    uint256 otherNode; require otherNode != nodeOperatorId;

    bool penalizedOther1 = isOperatorPenalized(e1, otherNode);
        clearNodeOperatorPenalty(e1, nodeOperatorId);
    bool penalizedOther2 = isOperatorPenalized(e1, otherNode);
    
    assert isOperatorPenaltyCleared(e2, nodeOperatorId);
    assert !isOperatorPenalized(e2, nodeOperatorId);
    assert penalizedOther2 == penalizedOther1;
}

/// Checks the penalty status transition after updating the stuck or the refunded
/// validators count for any node operator.
rule operatorPenaltyStatusAfterKeysUpdate(uint256 nodeOperatorId) {
    env e;
    uint64 validatorsCount;
    bool stuck_or_refunded;
    // Realistic time
    require e.block.timestamp + getStuckPenaltyDelay() <= to_mathint(UINT32_MAX());

    bool penalized_before = isOperatorPenalized(e, nodeOperatorId);
    uint256 refundedBefore = getNodeOperator_refundedValidators(nodeOperatorId);
    uint256 stuckBefore = getNodeOperator_stuckValidators(nodeOperatorId);
        if(stuck_or_refunded) {
            updateStuckValidatorsCount(e, nodeOperatorId, validatorsCount);
        }
        else {
            updateRefundedValidatorsCount(e, nodeOperatorId, validatorsCount);
        }
    bool penalized_after = isOperatorPenalized(e, nodeOperatorId);
    uint256 refundedAfter = getNodeOperator_refundedValidators(nodeOperatorId);
    uint256 stuckAfter = getNodeOperator_stuckValidators(nodeOperatorId);

    assert stuck_or_refunded => stuckAfter == require_uint256(validatorsCount);
    assert !stuck_or_refunded => refundedAfter == require_uint256(validatorsCount);
    assert penalized_before && stuckAfter > refundedAfter => penalized_after;
    assert !penalized_before && stuckAfter <= refundedAfter => !penalized_after;
    assert !penalized_before && stuckAfter > refundedAfter => penalized_after;
}

/// Actually supposed to check that _updateSummaryMaxValidatorsCount doesn't 
/// change the deposited keys count summary.
rule clearingPenaltyDoesntChangeDepositSummary(uint256 nodeOperatorId) {
    env e;
    uint256 summaryDeposited1 = getSummaryTotalDepositedValidators();
        clearNodeOperatorPenalty(e, nodeOperatorId);
    uint256 summaryDeposited2 = getSummaryTotalDepositedValidators();
    assert summaryDeposited2 == summaryDeposited1;
}

/// One shouldn't be able to call clearNodeOperatorPenalty on a non-existent node operator.
rule cannotClearPenaltyForUnRegisteredOperators(method f, uint256 nodeOperatorId) 
filtered{f -> !f.isView} {
    env e1;
    env e2; calldataarg args;
    env e3;
    requireInvariant UnregisteredOperatorIsNotPenalized(e1, nodeOperatorId);
    requireInvariant PenaltyClearedForUnregistered(e1, nodeOperatorId);
    requireInvariant UnregisteredOperatorIsNotPenalized(e3, nodeOperatorId);
    requireInvariant PenaltyClearedForUnregistered(e3, nodeOperatorId);
    require e1.block.timestamp <= e3.block.timestamp;
    require e1.block.timestamp > 0;
    
    clearNodeOperatorPenalty@withrevert(e1, nodeOperatorId);
    bool reverted_ = lastReverted;
    require nodeOperatorId >= getNodeOperatorsCount() => reverted_;

        f(e2, args);

    clearNodeOperatorPenalty@withrevert(e3, nodeOperatorId);
    bool _reverted = lastReverted;
    assert nodeOperatorId >= getNodeOperatorsCount() => _reverted;
}

/**************************************************
 *  Node Operator remove and adding keys rules  *
**************************************************/
/// For every node operators, it is always possible to add one more key
/// even if several keys were added before.
/*
rule noRestrictionOnAddingKeys(uint256 nodeOperatorId) {
    env e;
    uint256 keysCount1 = 1;
    uint256 keysCount2;
    bytes publicKeys1;
    bytes signatures1;
    bytes publicKeys2;
    bytes signatures2;

    /// This is the same require embedded in the code.
    require require_uint256(keysCount1 * 48) == publicKeys1.length;
    require require_uint256(keysCount1 * 96) == signatures1.length;
    /// Assume the number of keys don't overflow (otherwise reverts)
    require getNodeOperatorSigningStats_total(nodeOperatorId) +
        keysCount1 + keysCount2 < to_mathint(UINT64_MAX());
    safeAssumptions_NOS(nodeOperatorId);

    storage initState = lastStorage;
    // First simulate a case where adding 1 key is allowed.
    addSigningKeys(e, nodeOperatorId, keysCount1, publicKeys1, signatures1);

    // Now add an arbitrary number of keys.
    addSigningKeys(e, nodeOperatorId, keysCount2, publicKeys2, signatures2) at initState;
    addSigningKeys@withrevert(e, nodeOperatorId, keysCount1, publicKeys1, signatures1);

    assert !lastReverted;
}

rule keyCountChangeAfterKeysRemoval(uint256 nodeOperatorId, uint256 keysCount) {
    env e;
    uint256 index_from;
    require keysCount > 0;

    safeAssumptions_NOS(nodeOperatorId);
    
    uint256 vetted_before = getNodeOperatorSigningStats_vetted(nodeOperatorId);
    uint256 max_before = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 deposited_before = getNodeOperatorSigningStats_deposited(nodeOperatorId);
        removeSigningKeys(e, nodeOperatorId, index_from, keysCount);
    uint256 vetted_after = getNodeOperatorSigningStats_vetted(nodeOperatorId);
    uint256 max_after = getNodeOperatorTargetStats_max(nodeOperatorId);
    uint256 deposited_after = getNodeOperatorSigningStats_deposited(nodeOperatorId);
    
    if(vetted_before < index_from) {
        assert vetted_after == vetted_before;
        assert max_after == max_before;
        assert deposited_before == deposited_after;
    }
    else {
        assert vetted_after <= vetted_before - keysCount;
        assert max_after < max_before;
        assert deposited_before == deposited_after;
    }
}

rule addingKeysDoesntRevertObtainDepositData(uint256 nodeOperatorId) {
    env e1; env e2;
    calldataarg args1;
    uint256 keysCount;
    bytes publicKeys; bytes signatures;

    storage initState = lastStorage;
    safeAssumptions_NOS(nodeOperatorId);

    loadAllocatedSigningKeys(e1, args1);

    addSigningKeys(e2, nodeOperatorId, keysCount, publicKeys, signatures) at initState;
    loadAllocatedSigningKeys@withrevert(e1, args1);

    assert !lastReverted;
}

rule removingKeysDoesntRevertObtainDepositData(uint256 nodeOperatorId) {
    env e1; env e2;
    calldataarg args1;
    uint256 keysCount;
    uint256 fromIndex;

    storage initState = lastStorage;
    safeAssumptions_NOS(nodeOperatorId);

    loadAllocatedSigningKeys(e1, args1);
    
    removeSigningKeys(e2, nodeOperatorId, fromIndex, keysCount) at initState;
    loadAllocatedSigningKeys@withrevert(e1, args1);

    assert !lastReverted;
}
*/