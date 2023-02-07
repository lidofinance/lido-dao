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

rule sanity(method f) {
    env e;
    calldataarg args;
    f(e,args);
    assert false;
}

// https://vaas-stg.certora.com/output/41958/7205892f174546a9bb631d57d683eb24/?anonymousKey=870b36f147d44f5f06ed1b5723fa5adb654f8548
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
    assert statusAfter != ACTIVE();
}

rule StatusChangedToPaused(uint256 moduleId, method f)
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint8 statusBefore = getStakingModuleStatus(moduleId);
    require statusBefore != PAUSED();
    f(e, args);
    uint8 statusAfter = getStakingModuleStatus(moduleId);
    assert statusAfter != PAUSED();
}

rule StatusChangedToStopped(uint256 moduleId, method f) 
filtered{f -> !f.isView} {
    env e;
    calldataarg args;
    uint8 statusBefore = getStakingModuleStatus(moduleId);
    require statusBefore != STOPPED();
        f(e, args);
    uint8 statusAfter = getStakingModuleStatus(moduleId);
    assert statusAfter != STOPPED();
}