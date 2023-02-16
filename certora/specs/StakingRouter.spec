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
    uint256 _stakingModuleId;
    bytes _depositCalldata;
    uint256 keysCount = deposit(e, _maxDepositsCount, _stakingModuleId, _depositCalldata);
    
    // Force at least one call to deposit in the deposit contract.
    require(keysCount == 1);
    assert false;
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

rule aggregatedFeeLT100Percent() {
    env e;
    calldataarg args;
    
    safeAssumptions(getStakingModulesCount());
    require getStakingModulesCount() <= 1;

    string name;
    address Address;
    uint256 targetShare;
    uint256 ModuleFee;
    uint256 TreasuryFee;

    uint96 modulesFee_; uint96 treasuryFee_; uint256 precision_;
    modulesFee_, treasuryFee_, precision_ = getStakingFeeAggregateDistribution();
    assert modulesFee_ <= precision_;
    assert treasuryFee_ <= precision_; 
    
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
 
rule cannotInitializeTwice() {
    env e;
    calldataarg args1;
    calldataarg args2;
    initialize(e, args1);
    initialize@withrevert(e, args2);
    assert lastReverted;
}
