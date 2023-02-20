/**************************************************
 *      Top Level Properties / Rule Ideas         *
 **************************************************/
 // Write here your ideas for rules for tracking progress:

 // 1. The sum of all (active?) modules shares should always sum to 100% 

 // 2. Every module should get its underlying shares upon eth allocation.

 // 3. Staking modules are independent

 // Staking module parameters: for each staking module
 // a. targetShare <= 100%
 // b. stakingModuleFee + treasuryFee <= 100%
 // c. The protocol fee is distributed between modules proportionally
 //    to active validators and the specified module fee.

 // Who can set staking module parameters ?

 // Integrity rules:
 // a. deposit
 // b. addStakingModule

 // Status - actions correlation
 /***************************************************************
 Status             |   Perform deposits    |  Receive rewards   |
 ________________________________________________________________
 Active             |   Yes                 |   Yes              |
 Deposits paused    |   No                  |   Yes              |
 Stopped            |   No                  |   No               |
 ************************************************************** /

*/

import "./StakingRouterBase.spec"
import "./StakingRouterInvariants.spec"
use invariant modulesCountIsLastIndex
use invariant StakingModuleIdLELast
use invariant StakingModuleIndexIsIdMinus1
use invariant StakingModuleId
use invariant StakingModuleIdLECount
use invariant StakingModuleAddressIsNeverZero
use invariant StakingModuleTotalFeeLEMAX
use invariant StakingModuleTargetShareLEMAX

/**************************************************
 *                 MISC Rules                     *
 **************************************************/
rule sanity(method f) 
filtered{f -> !isDeposit(f)} {
    env e;
    calldataarg args;
    f(e,args);
    assert false;
}

rule depositSanity() {
    env e;
    require e.msg.value > 0;
    uint256 _maxDepositsCount;
    require _maxDepositsCount > 0;
    uint256 _stakingModuleId;
    bytes _depositCalldata;
    uint256 keysCount = deposit(e, _maxDepositsCount, _stakingModuleId, _depositCalldata);
    
    // Force at least one call to deposit in the deposit contract.
    require(keysCount > 0);
    assert false;
}

// The staking modules count can only increase by 1 or not change.
rule stakingModulesCountIncrement(method f) 
filtered{f-> !isDeposit(f)} {
    env e;
    calldataarg args;
    uint256 count1 = getStakingModulesCount();
        f(e, args);
    uint256 count2 = getStakingModulesCount();
    assert count1 == count2 || count2 == count1 + 1;
}

rule viewFunctionsThatNeverRevert(method f, method g) 
filtered{f -> f.isView && !harnessGetters(f), g -> isAddModule(g)} {
    env ef;
    env eg;
    calldataarg args_f;
    calldataarg args_g;

    f(ef, args_f);
    require getStakingModulesCount() <=1 ;
    safeAssumptions(getStakingModulesCount());

    g(eg, args_g);

    f@withrevert(ef, args_f);
    assert !lastReverted;
}

/**************************************************
 *          Status Transition Rules               *
 **************************************************/
rule StatusChangedToActive(uint256 moduleId, method f)
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;
    require !getStakingModuleIsActive(moduleId);
        
        f(e, args);
    
    assert getStakingModuleIsActive(moduleId) =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector ||
        f.selector == addStakingModule(string,address,uint256,uint256,uint256).selector ||
        f.selector == resumeStakingModule(uint256).selector);
}

rule StatusChangedToPaused(uint256 moduleId, method f)
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;
    require !getStakingModuleIsDepositsPaused(moduleId);

        f(e, args);

    assert getStakingModuleIsDepositsPaused(moduleId) =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector ||
        f.selector == pauseStakingModule(uint256).selector);
}

rule StatusChangedToStopped(uint256 moduleId, method f) 
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;
    require !getStakingModuleIsStopped(moduleId);
        
        f(e, args);

    assert getStakingModuleIsStopped(moduleId) =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector);
}

rule oneStatusChangeAtATime(uint256 moduleId, method f) 
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;
    uint256 otherModule;

    safeAssumptions(otherModule);
    safeAssumptions(moduleId);

    uint8 statusMain_Before = getStakingModuleStatus(moduleId);
    uint8 statusOther_Before = getStakingModuleStatus(otherModule);
        f(e, args);
    uint8 statusMain_After = getStakingModuleStatus(moduleId);
    uint8 statusOther_After = getStakingModuleStatus(otherModule);

    assert (statusMain_Before != statusMain_After && statusOther_Before != statusOther_After)
    => moduleId == otherModule;
}

invariant statusAtConstructor(uint256 id)
    id != 0 => getStakingModuleIsActive(id)
filtered{f -> f.isView}

/**************************************************
 *          Staking module parameters             *
 **************************************************/

rule ExitedValidatorsCountCannotDecrease(method f, uint256 moduleId) 
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;
    safeAssumptions(moduleId);
    uint256 exitedValidators1 = getStakingModuleExitedValidatorsById(moduleId);
        f(e, args);
    uint256 exitedValidators2 = getStakingModuleExitedValidatorsById(moduleId);
    assert exitedValidators2 >= exitedValidators1;
}

rule cannotAddStakingModuleIfAlreadyRegistered(uint256 index) {
    env e;
    string name;
    address stakingModuleAddress;
    uint256 targetShare;
    uint256 stakingModuleFee;
    uint256 treasuryFee;
    require index < getStakingModulesCount();
    addStakingModule(e, name, stakingModuleAddress, targetShare, stakingModuleFee, treasuryFee);
    assert stakingModuleAddress != getStakingModuleAddressByIndex(index);
}

rule aggregatedFeeLT100Percent_init() {
    env e;

    require getStakingModulesCount() == 0;

    string name;
    address Address;
    uint256 targetShare;
    uint256 ModuleFee;
    uint256 TreasuryFee;

    uint96 modulesFee_; uint96 treasuryFee_; uint256 precision_;
    modulesFee_, treasuryFee_, precision_ = getStakingFeeAggregateDistribution();
    assert modulesFee_ == 0;
    assert treasuryFee_ == 0; 
    
    addStakingModule(e, name, Address, targetShare, ModuleFee, TreasuryFee);

    uint96 _modulesFee; uint96 _treasuryFee; uint256 _precision;
    _modulesFee, _treasuryFee, _precision = getStakingFeeAggregateDistribution();

    assert _modulesFee <= _precision;
    assert _treasuryFee <= _precision;
    assert _modulesFee >= modulesFee_;
    assert _treasuryFee >= treasuryFee_;
}

rule aggregatedFeeLT100Percent_preserve() {
    env e;
    
    require getStakingModulesCount() == 1;
    safeAssumptions(getStakingModulesCount());
    
    string name;
    address Address;
    uint256 targetShare;
    uint256 ModuleFee;
    uint256 TreasuryFee;

    uint96 modulesFee_; uint96 treasuryFee_; uint256 precision_;
    modulesFee_, treasuryFee_, precision_ = getStakingFeeAggregateDistribution();
    require modulesFee_ <= precision_;
    require treasuryFee_ <= precision_;
    
    addStakingModule(e, name, Address, targetShare, ModuleFee, TreasuryFee);

    uint96 _modulesFee; uint96 _treasuryFee; uint256 _precision;
    _modulesFee, _treasuryFee, _precision = getStakingFeeAggregateDistribution();

    assert _modulesFee <= _precision;
    assert _treasuryFee <= _precision;
    assert _modulesFee >= modulesFee_;
    assert _treasuryFee >= treasuryFee_;
}

/**************************************************
 *          Revert Characteristics                *
 **************************************************/

rule feeDistributionDoesntRevertAfterAddingModule() {
    env e;
    calldataarg args;
    require getStakingModulesCount() <=1;
    safeAssumptions(1);
    getStakingFeeAggregateDistribution();
    
    addStakingModule(e, args);
    
    getStakingFeeAggregateDistribution@withrevert();

    assert !lastReverted;
}

rule canAlwaysAddAnotherStakingModule() {
    env e;
    string name1;
    address Address1;
    uint256 targetShare1;
    uint256 ModuleFee1;
    uint256 TreasuryFee1;

    string name2;
    address Address2;
    uint256 targetShare2;
    uint256 ModuleFee2;
    uint256 TreasuryFee2;

    safeAssumptions(getStakingModulesCount());
    // Assuming we don't reach the total cap of staking modules in the contract.
    require getStakingModulesCount() < 30;

    storage initState = lastStorage;

    addStakingModule(e, name1, Address1, targetShare1, ModuleFee1, TreasuryFee1);

    addStakingModule(e, name2, Address2, targetShare2, ModuleFee2, TreasuryFee2) at initState;
    
    // This function fetches the `name` attribute of the next struct in the mapping
    // to make sure there was a valid storage state before calling the addStakingModule function
    // and writing to that storage slot.
    getStakingModuleNameLengthByIndex(getStakingModulesCount());

    addStakingModule@withrevert(e, name1, Address1, targetShare1, ModuleFee1, TreasuryFee1);

    assert !lastReverted;
}
 
rule cannotInitializeTwice() {
    env e;
    calldataarg args1;
    calldataarg args2;
    initialize(e, args1);
    initialize@withrevert(e, args2);
    assert lastReverted;
}

rule canAlwaysGetAddedStakingModule() {
    env e;
    calldataarg args;
    uint256 id = getStakingModulesCount() + 1;
    requireInvariant modulesCountIsLastIndex();
    addStakingModule(e, args);

    getStakingModuleIndexById@withrevert(id);
    assert !lastReverted;
    getStakingModuleIdById@withrevert(id);
    assert !lastReverted;
}

rule getMaxDepositsCountReverts_init(uint256 id) {
    env e;

    requireInvariant modulesCountIsLastIndex();
    // Post contructor state
    require getStakingModuleIndexOneBased(id) == 0;
    getStakingModuleMaxDepositsCount@withrevert(e, id);
    assert lastReverted;
}

rule getMaxDepositsCountReverts_preserve(method f, uint256 id) 
filtered{f -> !f.isView && !isDeposit(f)} {
    env e;
    calldataarg args;

    requireInvariant modulesCountIsLastIndex();
    getStakingModuleMaxDepositsCount@withrevert(e, id);
    bool reverted_A = lastReverted;
    require reverted_A <=> (id > getStakingModulesCount() || id == 0);

    f(e, args);

    getStakingModuleMaxDepositsCount@withrevert(e, id);
    bool reverted_B = lastReverted;
    assert reverted_B <=> (id > getStakingModulesCount() || id == 0);
}

rule depositRevertsForInvalidModuleId(uint256 id) {
    env e;
    uint256 maxDepositsCount;
    bytes calldata; require calldata.length == 0;

    getStakingModuleMaxDepositsCount@withrevert(e, id);
    require lastReverted;

    deposit@withrevert(e, maxDepositsCount, id, calldata);
    bool deposit_reverted = lastReverted;

    assert (id > getStakingModulesCount() || id == 0) => deposit_reverted;
}
