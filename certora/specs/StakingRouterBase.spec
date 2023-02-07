/**************************************************
 *                 Methods Declaration            *
 **************************************************/
methods {
    // StakingModule
    updateExitedValidatorsKeysCount(uint256,uint256) => DISPATCHER(true)
    handleRewardsMinted(uint256) => DISPATCHER(true)
    getValidatorsKeysStats(uint256) => DISPATCHER(true)
    getValidatorsKeysStats() => DISPATCHER(true)
    invalidateReadyToDepositKeys() => DISPATCHER(true)
    requestValidatorsKeysForDeposits(uint256,bytes) => DISPATCHER(true)
    getValidatorsKeysNonce() => DISPATCHER(true)
    updateStuckValidatorsKeysCount(uint256, uint256) => DISPATCHER(true)
    finishUpdatingExitedValidatorsKeysCount() => DISPATCHER(true)
    unsafeUpdateValidatorsKeysCount(uint256,uint256,uint256) => DISPATCHER(true)

    // Lido
    getBufferedEther() returns (uint256) => DISPATCHER(true)
    receiveStakingRouterDepositRemainder() => DISPATCHER(true)

    // StakingRouter
     getStakingModulesCount() returns (uint256) envfree
     getStakingModuleStatus(uint256) returns (uint8) envfree
}

/**************************************************
 *                 Definitions                    *
 **************************************************/
 // Staking module status:
definition ACTIVE() returns uint8 = 0; 
definition PAUSED() returns uint8 = 1; 
definition STOPPED() returns uint8 = 2; 