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

/**************************************************
 *                 MISC Rules                     *
 **************************************************/
rule sanity(method f) 
filtered{f -> f.selector != deposit(uint256,uint256,bytes).selector} {
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
    require(keysCount != 0);
    assert false;
}

/**************************************************
 *          Status Transition Rules               *
 **************************************************/
rule StatusChangedToActive(uint256 moduleId, method f)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint8 statusBefore = getStakingModuleStatus(moduleId);
    require statusBefore != ACTIVE();
    f(e, args);
    uint8 statusAfter = getStakingModuleStatus(moduleId);
    assert statusAfter == ACTIVE() =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector ||
        f.selector == addStakingModule(string,address,uint16,uint16,uint16).selector ||
        f.selector == resumeStakingModule(uint256).selector);
}

rule StatusChangedToPaused(uint256 moduleId, method f)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint8 statusBefore = getStakingModuleStatus(moduleId);
    require statusBefore != PAUSED();
    f(e, args);
    uint8 statusAfter = getStakingModuleStatus(moduleId);
    assert statusAfter == PAUSED() =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector ||
        f.selector == pauseStakingModule(uint256).selector);
}

rule StatusChangedToStopped(uint256 moduleId, method f) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint8 statusBefore = getStakingModuleStatus(moduleId);
    require statusBefore != STOPPED();
        f(e, args);
    uint8 statusAfter = getStakingModuleStatus(moduleId);
    assert statusAfter == STOPPED() =>
        (f.selector == setStakingModuleStatus(uint256,uint8).selector);
}

/**************************************************
 *          Staking module parameters             *
 **************************************************/
