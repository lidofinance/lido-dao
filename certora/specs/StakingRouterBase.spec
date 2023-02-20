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
    // Will be set back to dispatcher once the implementation of loadKeys is replaced.
    obtainDepositData(uint256, bytes) returns (uint256, bytes, bytes) => NONDET // DISPATCHER(true)
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

    // StakingRouter
     getStakingModulesCount() returns (uint256) envfree
     getStakingModuleStatus(uint256) returns (uint8) envfree
     getStakingModuleIsStopped(uint256) returns (bool) envfree
     getStakingModuleIsDepositsPaused(uint256) returns (bool) envfree
     getStakingModuleIsActive(uint256) returns (bool) envfree
     getStakingFeeAggregateDistribution() returns (uint96,uint96,uint256) envfree
     getStakingModuleMaxDepositsCount(uint256) returns (uint256)
     FEE_PRECISION_POINTS() returns (uint256) envfree
     TOTAL_BASIS_POINTS() returns (uint256) envfree

     // StakingRouter harness getters
     getStakingModuleAddressByIndex(uint256) returns (address) envfree
     getStakingModuleAddressById(uint256) returns (address) envfree
     getStakingModuleExitedValidatorsById(uint256) returns (uint256) envfree
     getStakingModuleIdById(uint256) returns (uint256) envfree
     getStakingModuleIndexById(uint256) returns (uint256) envfree
     getLastStakingModuleId() returns (uint24) envfree
     getStakingModuleFeeById(uint256) returns (uint16) envfree
     getStakingModuleTreasuryFeeById(uint256) returns (uint16) envfree
     getStakingModuleTargetShareById(uint256) returns (uint16) envfree
     getStakingModuleNameLengthByIndex(uint256) returns (uint256) envfree
     getStakingModuleIndexOneBased(uint256) returns (uint256) envfree
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

definition harnessGetters(method f) returns bool =
    f.selector == getStakingModuleAddressByIndex(uint256).selector ||
    f.selector == getStakingModuleAddressById(uint256).selector ||
    f.selector == getStakingModuleExitedValidatorsById(uint256).selector ||
    f.selector == getStakingModuleIdById(uint256).selector ||
    f.selector == getStakingModuleIndexById(uint256).selector ||
    f.selector == getLastStakingModuleId().selector ||
    f.selector == getStakingModuleFeeById(uint256).selector ||
    f.selector == getStakingModuleTreasuryFeeById(uint256).selector  ||
    f.selector == getStakingModuleTargetShareById(uint256).selector ||
    f.selector == getStakingModuleNameLengthByIndex(uint256).selector ||
    f.selector == getStakingModuleIndexOneBased(uint256).selector;

// Signature and public key batch count
definition keyCount() returns uint256 = 4;