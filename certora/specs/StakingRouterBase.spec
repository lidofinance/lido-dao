/**************************************************
 *                 Methods Declaration            *
 **************************************************/
methods {
    // StakingModule
    getType() returns (bytes32) => DISPATCHER(true)
    getStakingModuleSummary() returns(uint256, uint256, uint256) => DISPATCHER(true)
    getNodeOperatorSummary(uint256) => DISPATCHER(true)
    getNonce() returns (uint256) => DISPATCHER(true)
    updateStuckValidatorsCount(uint256, uint256) => DISPATCHER(true)
    updateExitedValidatorsCount(uint256, uint256) => DISPATCHER(true) 
    updateRefundedValidatorsCount(uint256, uint256) => DISPATCHER(true)
    obtainDepositData(uint256, bytes) returns (uint256, bytes, bytes) => DISPATCHER(true)
    handleRewardsMinted(uint256) => DISPATCHER(true)
    onWithdrawalCredentialsChanged() => DISPATCHER(true)
    onAllValidatorCountersUpdated() => DISPATCHER(true)
    unsafeUpdateValidatorsCount(uint256,uint256,uint256) => DISPATCHER(true)
    getNodeOperatorsCount() returns (uint256) => DISPATCHER(true)
    getActiveNodeOperatorsCount() returns (uint256) => DISPATCHER(true)
    getNodeOperatorIsActive(uint256) returns (bool) => DISPATCHER(true)
    getNodeOperatorIds(uint256, uint256) returns (uint256[]) => DISPATCHER(true)

    // Lido
    getDepositableEther() returns (uint256) => DISPATCHER(true)
    receiveStakingRouterDepositRemainder() => DISPATCHER(true)

    // NodeOperatorsRegistry
     hasPermission(address, address, bytes32, bytes) returns (bool) => NONDET 

    // StakingRouter
     getStakingModulesCount() returns (uint256) envfree
     getStakingModuleStatus(uint256) returns (uint8) envfree
     getStakingModuleIsStopped(uint256) returns (bool) envfree
     getStakingModuleIsDepositsPaused(uint256) returns (bool) envfree
     getStakingModuleIsActive(uint256) returns (bool) envfree
     getStakingFeeAggregateDistribution() returns (uint96,uint96,uint256) envfree

     // StakingRouter harness getters
     getStakingModuleAddressByIndex(uint256) returns (address) envfree
     getStakingModuleAddressById(uint256) returns (address) envfree
     getStakingModuleExitedValidatorsById(uint256) returns (uint256) envfree
     getStakingModuleIdById(uint256) returns (uint256) envfree
     getStakingModuleIndexById(uint256) returns (uint256) envfree
     getLastStakingModuleId() returns (uint24) envfree
}

/**************************************************
 *                 Definitions                    *
 **************************************************/
// Methods:
definition isDeposit(method f) returns bool = 
    f.selector == deposit(uint256,uint256,bytes).selector;

definition isAddModule(method f) returns bool = 
    f.selector == addStakingModule(string,address,uint256,uint256,uint256).selector;

// Staking module status:
definition ACTIVE() returns uint8 = 0; 
definition PAUSED() returns uint8 = 1; 
definition STOPPED() returns uint8 = 2; 

// Signature and public key batch count
definition keyCount() returns uint256 = 4;