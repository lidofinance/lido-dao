using NativeTransferFuncs as NTF;

/**************************************************
*                   Methods                       *
**************************************************/
methods{
    function initialize(address, address) external;
    function finalizeUpgrade_v2(address, address) external;
    function pauseStaking() external;
    function resumeStaking() external;
    function setStakingLimit(uint256, uint256) external;
    function removeStakingLimit() external;
    function isStakingPaused() external returns (bool) envfree;
    function getCurrentStakeLimit() external returns (uint256); // envfree 
    function getStakeLimitFullInfo() external returns (bool, bool, uint256, uint256, uint256, uint256, uint256); // envfree
    function submit(address) external returns (uint256); //payable
    function receiveELRewards() external; //payable
    function receiveWithdrawals() external; //payable
    function deposit(uint256, uint256, bytes) external;
    function stop() external;
    function resume() external;
    // handle oracle report
    function unsafeChangeDepositedValidators(uint256) external;
    function handleOracleReport(uint256, uint256) external;
    function transferToVault(address) external;
    function getFee() external returns (uint16) envfree;
    function getFeeDistribution() external returns (uint16, uint16, uint16) envfree;
    function getWithdrawalCredentials() external returns (bytes32) envfree;
    function getBufferedEther() external returns (uint256) envfree;
    function getTotalELRewardsCollected() external returns (uint256) envfree;
    function getOracle() external returns (address) envfree;
    function getTreasury() external returns (address) envfree;
    function getBeaconStat() external returns (uint256, uint256, uint256) envfree;
    function canDeposit() external returns (bool) envfree;
    function getDepositableEther() external returns (uint256) envfree;
    function permit(address,address,uint256,uint256,uint8,bytes32,bytes32) external;

    // StEth:
    function getTotalPooledEther() external returns (uint256) envfree;
    function getTotalShares() external returns (uint256) envfree;
    function sharesOf(address) external returns (uint256) envfree;
    function getSharesByPooledEth(uint256) external returns (uint256) envfree;
    function getPooledEthByShares(uint256) external returns (uint256) envfree;
    function transferShares(address, uint256) external returns (uint256);
    function transferSharesFrom(address, address, uint256) external returns (uint256);

    // function getRatio() external returns(uint256) envfree;
    // function getCLbalance() external returns(uint256) envfree;
    function _.smoothenTokenRebase(uint256, uint256, uint256, uint256, uint256, uint256, uint256) external => DISPATCHER(true);
    function _.getSharesRequestedToBurn() external => DISPATCHER(true);
    function _.checkAccountingOracleReport(uint256, uint256, uint256, uint256, uint256, uint256, uint256) external => DISPATCHER(true);

    // Harness:
    function stakingModuleMaxDepositsCount(uint256, uint256) external returns (uint256) envfree;
    function LidoEthBalance() external returns (uint256) envfree;
    function getEthBalance(address) external returns (uint256) envfree;
    function collectRewardsAndProcessWithdrawals(uint256, uint256, uint256, uint256, uint256) external;

    // Summarizations:

    // WithdrawalQueue:
    function _.isBunkerModeActive() internal => CONSTANT;
    function _.isPaused() internal => isWithdrawalQueuePaused() expect bool ALL;
    function _.unfinalizedStETH() internal => UnfinalizedStETH() expect uint256 ALL;

    // LidoLocator:
    function _.getLidoLocator() internal => ghostLidoLocator() expect address ALL;
    function _.depositSecurityModule() internal => ghostDSM() expect address ALL;
    function _.stakingRouter() internal => ghostStakingRouter() expect address ALL;
    function _.getRecoveryVault() internal => ghostRecoveryVault() expect address ALL;
    function _.treasury() internal => ghostTreasury() expect address ALL;
    function _.legacyOracle() internal => ghostLegacyOracle() expect address ALL;
    function _.withdrawalQueue() internal => ghostWithdrawalQueue() expect address ALL;
    function _.burner() internal => ghostBurner() expect address ALL;
    function _.withdrawalVault() internal => ghostWithdrawalVault() expect address ALL;
    function _.elRewardsVault() internal => ghostELRewardsVault() expect address ALL;
    function _.oracleReportComponentsForLido() internal => NONDET;

    // StakingRouter:
    function _.getStakingFeeAggregateDistributionE4Precision() internal => CONSTANT;
    function _.getStakingModuleMaxDepositsCount(uint256 id, uint256 maxValue) internal => MaxDepositsCount(id, maxValue) expect uint256 ALL;
    function _.getWithdrawalCredentials() internal => ghostWithdrawalCredentials() expect bytes32 ALL;
    function _.getTotalFeeE4Precision() internal => ghostTotalFeeE4Precision() expect uint16 ALL;
    function _.deposit(uint256,uint256,bytes) external => DISPATCHER(true);
    
    function _.getApp(bytes32 a,bytes32 b) internal => getAppGhost(a, b) expect address ALL;
    function _.hashTypedDataV4(address _stETH, bytes32 _structHash) internal => ghostHashTypedDataV4(_stETH, _structHash) expect bytes32 ALL;
    function _.getScriptExecutor(bytes) external => CONSTANT;
    function _.domainSeparatorV4(address) internal => CONSTANT;
    function _.eip712Domain(address) internal =>  NONDET; // Hopefully the nondeterministic behavior is not crucial
    function _.canPerform(address, bytes32, uint256[]) external => ALWAYS(true); // Warning: optimistic permission summary
    //hasPermission(address, address, bytes32, bytes) returns (bool) => ALWAYS(true);
    function _.getEIP712StETH() internal => ghostEIP712StETH() expect address ALL; //(assuming after initialize)

    // nativeTransferFuncs:
    function NTF.withdrawRewards(uint256) external returns (uint256);
    function NTF.withdrawWithdrawals(uint256) external;

    function _.withdrawRewards(uint256) external => DISPATCHER(true);
    function _.withdrawWithdrawals(uint256) external => DISPATCHER(true);

    function _.finalize(uint256, uint256) external => DISPATCHER(true);
}

/**************************************************
*             Ghosts summaries                    *
**************************************************/
ghost ghostLidoLocator() returns address {
    axiom ghostLidoLocator() != currentContract;
    axiom ghostLidoLocator() != 0;
}

ghost ghostDSM() returns address {
    axiom ghostDSM() != currentContract;
    axiom ghostDSM() != 0;
} 

ghost ghostStakingRouter() returns address {
    axiom ghostStakingRouter() != currentContract;
    axiom ghostStakingRouter() != 0;
}

ghost ghostRecoveryVault() returns address {
    axiom ghostRecoveryVault() != currentContract;
    axiom ghostRecoveryVault() != 0;
}

ghost ghostTreasury() returns address {
    axiom ghostTreasury() != currentContract;
    axiom ghostTreasury() != 0;
}

ghost ghostBurner() returns address {
    axiom ghostBurner() != currentContract;
    axiom ghostBurner() != 0;
}

ghost ghostLegacyOracle() returns address {
    axiom ghostLegacyOracle() != currentContract;
    axiom ghostLegacyOracle() != 0;
}

ghost ghostWithdrawalQueue() returns address {
    axiom ghostWithdrawalQueue() != currentContract;
    axiom ghostWithdrawalQueue() != 0;
}

ghost ghostWithdrawalVault() returns address {
    axiom ghostWithdrawalVault() != currentContract;
    axiom ghostWithdrawalVault() != 0;
}

ghost ghostELRewardsVault() returns address {
    axiom ghostELRewardsVault() != currentContract;
    axiom ghostELRewardsVault() != 0;
}

ghost ghostEIP712StETH() returns address {
    axiom ghostEIP712StETH() != 0;
}

ghost ghostWithdrawalCredentials() returns bytes32;

ghost ghostTotalFeeE4Precision() returns uint16 {
    axiom to_mathint(ghostTotalFeeE4Precision()) <= 10000;
}

ghost getAppGhost(bytes32, bytes32) returns address {
    axiom forall bytes32 a . forall bytes32 b . 
        getAppGhost(a, b) != 0 && 
        getAppGhost(a, b) != currentContract;
}

ghost ghostHashTypedDataV4(address, bytes32) returns bytes32 {
    axiom forall address steth. forall bytes32 a .forall bytes32 b . 
        a != b => 
        ghostHashTypedDataV4(steth, a) != ghostHashTypedDataV4(steth, b);
}

ghost MaxDepositsCount(uint256, uint256) returns uint256 {
    axiom forall uint256 ID. forall uint256 maxValue.
        to_mathint(MaxDepositsCount(ID, maxValue)) <= (maxValue / DEPOSIT_SIZE());
}

ghost uint256 ghostUnfinalizedStETH;

function UnfinalizedStETH() returns uint256 {
    /// Needs to be havoc'd after some call (figure out when and how)
    return ghostUnfinalizedStETH;
}

ghost bool WQPaused;

function isWithdrawalQueuePaused() returns bool {
    return WQPaused;
}

/**************************************************
*                    CVL Helpers                 *
**************************************************/
/**
To avoid overflow
**/
function SumOfETHBalancesLEMax(address someUser) returns bool {
    mathint sum = 
        LidoEthBalance() + 
        getTotalELRewardsCollected() +
        getTotalPooledEther() +
        getEthBalance(ghostRecoveryVault()) +
        getEthBalance(ghostStakingRouter()) +
        getEthBalance(ghostWithdrawalQueue()) + 
        getEthBalance(ghostTreasury()) + 
        getEthBalance(ghostRecoveryVault()) + 
        getEthBalance(ghostDSM()) +
        getEthBalance(someUser);
    return sum <= to_mathint(Uint128());
}

/**
To avoid overflow
**/
function SumOfSharesLEMax(address someUser) returns bool {
    mathint sum = 
        sharesOf(currentContract) + 
        sharesOf(ghostRecoveryVault()) +
        sharesOf(ghostStakingRouter()) +
        sharesOf(ghostWithdrawalQueue()) + 
        sharesOf(ghostTreasury()) + 
        sharesOf(ghostRecoveryVault()) + 
        sharesOf(ghostDSM()) +
        sharesOf(someUser);
    return sum <= to_mathint(Uint128());
}

/**
To avoid overflow
**/
function ReasonableAmountOfShares() returns bool {
    return getTotalShares() < Uint128() && getTotalPooledEther() < Uint128();
}

/**************************************************
*                    Definitions                 *
**************************************************/
definition DEPOSIT_SIZE() returns uint256 = 32000000000000000000;
definition Uint128() returns uint256 = (1 << 128);  

definition isHandleReport(method f) returns bool = 
    f.selector == 
    sig:handleOracleReport(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256[],uint256).selector;

definition isSubmit(method f) returns bool = 
    f.selector == sig:submit(address).selector;

definition handleReportStepsMethods(method f) returns bool = 
    isHandleReport(f) || 
    f.selector == sig:collectRewardsAndProcessWithdrawals(uint256,uint256,uint256,uint256,uint256).selector ||
    f.selector == sig:processRewards(uint256,uint256,uint256).selector ||
    f.selector == sig:processClStateUpdate(uint256,uint256,uint256,uint256).selector ||
    f.selector == sig:distributeFee(uint256,uint256,uint256).selector ||
    f.selector == sig:transferModuleRewards(address[],uint96[],uint256,uint256).selector ||
    f.selector == sig:transferTreasuryRewards(uint256).selector ||
    f.selector == sig:completeTokenRebase(address).selector;

/**************************************************
*                    Rules                 *
**************************************************/
invariant BufferedEthIsAtMostLidoBalance()
    getBufferedEther() <= LidoEthBalance()
    filtered{f -> !isHandleReport(f) && f.selector != sig:permit(address,address,uint256,uint256,uint8,bytes32,bytes32).selector}
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
            require SumOfETHBalancesLEMax(e.msg.sender);
            require ReasonableAmountOfShares();
        }
    }

// /// Fails due to overflows.
// /// Need to come up with a condition on the total shares to prevent the overflows cases.
// rule getSharesByPooledEthDoesntRevert(uint256 amount, method f) 
// filtered{f -> !f.isView && !isHandleReport(f)} {
//     env e;
//     calldataarg args;
//     require SumOfETHBalancesLEMax(e.msg.sender);
//     require SumOfSharesLEMax(e.msg.sender);
//     require ReasonableAmountOfShares();
//     require amount < Uint128();

//     getSharesByPooledEth(amount);
//         f(e, args);
//     getSharesByPooledEth@withrevert(amount);

//     assert !lastReverted;
// }

// rule submitCannotDoSFunctions(method f) 
// filtered{f -> !(handleReportStepsMethods(f) || isSubmit(f))} {
//     env e1; 
//     env e2;
//     require e2.msg.sender != currentContract;
//     calldataarg args;
//     address referral;
//     uint256 amount;

//     storage initState = lastStorage;
//     require SumOfETHBalancesLEMax(e2.msg.sender);
//     require ReasonableAmountOfShares();
    
//     f(e1, args);
    
//     submit(e2, referral) at initState;

//     f@withrevert(e1, args);

//     assert !lastReverted;
// }

/**
After calling submit:
    1. If there is a satke limit then it must decrease by ther submited eth amount.
    2. The user gets the expected amount of shares.
    3. Total shares is increased as expected.
**/
rule integrityOfSubmit(address _referral) {
    env e;
    uint256 ethToSubmit = e.msg.value;
    uint256 old_stakeLimit = getCurrentStakeLimit(e);
    uint256 expectedShares = getSharesByPooledEth(ethToSubmit);
    
    uint256 shareAmount = submit(e, _referral);

    uint256 new_stakeLimit = getCurrentStakeLimit(e);

    assert (old_stakeLimit < max_uint256) => (new_stakeLimit == assert_uint256(old_stakeLimit - ethToSubmit));
    assert expectedShares == shareAmount;
}

/**
After a successful call for deposit:
    1. Bunker mode is inactive and the protocol is not stopped
    2. If any of max deposits is greater than zero then the buffered ETH must decrease.
    3. The buffered ETH must not increase.
**/
rule integrityOfDeposit(uint256 _maxDepositsCount, uint256 _stakingModuleId, bytes _depositCalldata) {
    env e;

    bool canDeposit = canDeposit();
    uint256 stakeLimit = getCurrentStakeLimit(e);
    uint256 bufferedEthBefore = getBufferedEther();

    uint256 maxDepositsCountSR = stakingModuleMaxDepositsCount(_stakingModuleId, getDepositableEther());

    deposit(e, _maxDepositsCount, _stakingModuleId, _depositCalldata);

    uint256 bufferedEthAfter = getBufferedEther();

    assert canDeposit;
    assert (_maxDepositsCount > 0 && maxDepositsCountSR > 0) => bufferedEthBefore > bufferedEthAfter;
    assert assert_uint256(bufferedEthBefore - bufferedEthAfter) <= bufferedEthBefore;
}

/**
After a successful call for collectRewardsAndProcessWithdrawals:
    1. TOTAL_EL_REWARDS_COLLECTED_POSITION increase by
    2. contracts ETH balance must increase by elRewardsToWithdraw + withdrawalsToWithdraw - etherToLockOnWithdrawalQueue
    3. The buffered ETH must increase elRewardsToWithdraw + withdrawalsToWithdraw - etherToLockOnWithdrawalQueue
**/
rule integrityOfCollectRewardsAndProcessWithdrawals(uint256 withdrawalsToWithdraw, uint256 elRewardsToWithdraw, uint256 withdrawalFinalizationBatch, uint256 simulatedShareRate, uint256 etherToLockOnWithdrawalQueue) {
    env e;
    require SumOfETHBalancesLEMax(e.msg.sender);
    require ReasonableAmountOfShares();

    uint256 contractEthBalanceBefore = LidoEthBalance();
    uint256 totalElRewardsBefore = getTotalELRewardsCollected();
    uint256 bufferedEthBefore = getBufferedEther();

    collectRewardsAndProcessWithdrawals(e, withdrawalsToWithdraw, elRewardsToWithdraw, withdrawalFinalizationBatch, simulatedShareRate, etherToLockOnWithdrawalQueue);

    uint256 contractEthBalanceAfter = LidoEthBalance();
    uint256 totalElRewardsAfter = getTotalELRewardsCollected();
    uint256 bufferedEthAfter = getBufferedEther();

    assert assert_uint256(contractEthBalanceBefore + withdrawalsToWithdraw + elRewardsToWithdraw - etherToLockOnWithdrawalQueue) == contractEthBalanceAfter;
    assert assert_uint256(totalElRewardsBefore + elRewardsToWithdraw) == totalElRewardsAfter;
    assert assert_uint256(bufferedEthBefore + withdrawalsToWithdraw + elRewardsToWithdraw - etherToLockOnWithdrawalQueue) == bufferedEthAfter;
}

/**************************************************
 *                   MISC Rules                   *
 **************************************************/
rule sanity(method f) 
    filtered { f -> !f.isView }
{
    env e; calldataarg args;

    f(e,args);
    assert false;
}