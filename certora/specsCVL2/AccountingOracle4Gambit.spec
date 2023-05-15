using MockConsensusContract as ConsensusContract;
using AccountingOracle as AccountingOracleContract;
using StakingRouter as StakingRouterContract;
// using LidoLocator as LidoLocatorContract
using OracleReportSanityChecker as OracleReportSanityCheckerContract;
using MockLidoForAccountingOracle as LidoContract;
using MockWithdrawalQueueForAccountingOracle as WithdrawalQueueContract;
using StakingModuleMock as StakingModuleContract;
using LegacyOracle as LegacyOracleContract;

/**************************************************
 *               Methods Declaration              *
 **************************************************/
methods {
    function LIDO() external returns (address) envfree;
    function LOCATOR() external returns (address) envfree;
    function LEGACY_ORACLE() external returns (address) envfree;

    function EXTRA_DATA_FORMAT_EMPTY() external returns (uint256) envfree;
    function EXTRA_DATA_FORMAT_LIST() external returns (uint256) envfree;

    // IConsensusContract = MockConsensusContract.sol
    function _.getChainConfig() external => DISPATCHER(true);
    function _.getCurrentFrame() external => DISPATCHER(true);
    function _.getIsMember(address) external => DISPATCHER(true);
    function _.getFrameConfig() external => DISPATCHER(true);
    function _.getInitialRefSlot() external => DISPATCHER(true);

    // Locator = LidoLocator.sol
    function _.stakingRouter() external => NONDET;
    function _.oracleReportSanityChecker() external => NONDET;
    function _.withdrawalQueue() external => NONDET;

    // StakingRouter = StakingRouter.sol
    function _.reportStakingModuleExitedValidatorsCountByNodeOperator(uint256, bytes, bytes) external => DISPATCHER(true);
    function _.reportStakingModuleStuckValidatorsCountByNodeOperator(uint256, bytes, bytes) external => DISPATCHER(true);
    function _.onValidatorsCountsByNodeOperatorReportingFinished() external => DISPATCHER(true);
    function _.getExitedValidatorsCountAcrossAllModules() external => DISPATCHER(true);
    function _.updateExitedValidatorsCountByStakingModule(uint256[], uint256[]) external => DISPATCHER(true);

    // OracleReportSanityChecker = OracleReportSanityChecker.sol
    function _.checkNodeOperatorsPerExtraDataItemCount(uint256, uint256) external => DISPATCHER(true);
    function _.checkAccountingExtraDataListItemsCount(uint256) external => DISPATCHER(true);
    function _.checkExitedValidatorsRatePerDay(uint256) external => DISPATCHER(true);

    // LegacyOracle = MockLegacyOracle.sol
    function _.getBeaconSpec() external => DISPATCHER(true); // might be able to simplify, only used for one check
    function _.getLastCompletedEpochId() external => DISPATCHER(true);
    function _.handleConsensusLayerReport(uint256, uint256, uint256) external => DISPATCHER(true);
    function _.getConsensusContract() external => DISPATCHER(true); //getConsensusContractCVL()
    function _.getAccountingOracle() external => DISPATCHER(true); //getAccountingOracleContractCVL()
    function _.handlePostTokenRebase(uint256,uint256,uint256,uint256,uint256,uint256,uint256) external => DISPATCHER(true);

    // WithdrawalQueue = WithdrawalQueue.sol
    //updateBunkerMode(bool, uint256) => DISPATCHER(true)
    function _.onOracleReport(bool, uint256, uint256) external => DISPATCHER(true);

    // Lido = MockLidoForAccountingOracle.sol
    function _.handleOracleReport(uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256[], uint256) external => DISPATCHER(true);

    // StakingModule = StakingModuleMock.sol
    function _.getStakingModuleSummary() external => DISPATCHER(true);
    function _.onExitedAndStuckValidatorsCountsUpdated() external => DISPATCHER(true);
    function _.updateExitedValidatorsCount(bytes, bytes) external => DISPATCHER(true);
    function _.updateStuckValidatorsCount(bytes, bytes) external => DISPATCHER(true);
}

/**************************************************
 *                CVL FUNCS & DEFS                *
 **************************************************/
function getAccountingOracleContractCVL() returns address {
    return currentContract;
}

function getConsensusContractCVL() returns address {
    return ConsensusContract;
}

// this function if required to be TRUE, ensures correct contract linking
function contractAddressesLinked() returns bool {
    env e0;
    address consensusContractAddress = getConsensusContract(e0);
    address accountingOracleAddress = LegacyOracleContract.getAccountingOracle(e0);
    
    return  (consensusContractAddress == ConsensusContract) &&
            (accountingOracleAddress == AccountingOracleContract);
}

definition UINT64_MAX() returns uint64 = 0xFFFFFFFFFFFFFFFF;
definition UINT256_MAX() returns uint256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

// definition DEFAULT_ADMIN_ROLE() returns bytes32 = 0x00;  // CVL2 error: Overloading not allowed for definitions

//definition MANAGE_MEMBERS_AND_QUORUM_ROLE() returns bytes32 = 0x66a484cf1a3c6ef8dfd59d24824943d2853a29d96f34a01271efc55774452a51; //keccak256("MANAGE_MEMBERS_AND_QUORUM_ROLE");
//definition DISABLE_CONSENSUS_ROLE() returns bytes32 = 0x10b016346186602d93fc7a27ace09ba944baf9453611b186d36acd3d3d667dc0; //keccak256("DISABLE_CONSENSUS_ROLE");
//definition MANAGE_FRAME_CONFIG_ROLE() returns bytes32 = 0x921f40f434e049d23969cbe68d9cf3ac1013fbe8945da07963af6f3142de6afe; //keccak256("MANAGE_FRAME_CONFIG_ROLE");
//definition MANAGE_FAST_LANE_CONFIG_ROLE() returns bytes32 = 0x4af6faa30fabb2c4d8d567d06168f9be8adb583156c1ecb424b4832a7e4d6717; //keccak256("MANAGE_FAST_LANE_CONFIG_ROLE");
//definition MANAGE_REPORT_PROCESSOR_ROLE() returns bytes32 = 0xc5219a8d2d0107a57aad00b22081326d173df87bad251126f070df2659770c3e; //keccak256("MANAGE_REPORT_PROCESSOR_ROLE");

// CVL2 Error: The identifier MANAGE_CONSENSUS_VERSION_ROLE has already been declared in scope (Spec file). Overloading not allowed for definitions
// definition MANAGE_CONSENSUS_CONTRACT_ROLE() returns bytes32 = 0x04a0afbbd09d5ad397fc858789da4f8edd59f5ca5098d70faa490babee945c3b; //keccak256("MANAGE_CONSENSUS_CONTRACT_ROLE");
// definition MANAGE_CONSENSUS_VERSION_ROLE() returns bytes32 = 0xc31b1e4b732c5173dc51d519dfa432bad95550ecc4b0f9a61c2a558a2a8e4341; //keccak256("MANAGE_CONSENSUS_VERSION_ROLE");
// definition SUBMIT_DATA_ROLE() returns bytes32 = 0x65fa0c17458517c727737e4153dd477fa3e328cf706640b0f68b1a285c5990da; //keccak256("SUBMIT_DATA_ROLE");



//  rules for AccountingOracle (without inheritance):
// ------------------------------------------------------------------------------------------
//  external non-view functions: initialize(), initializeWithoutMigration(), submitReportData(),
//                               submitReportExtraDataEmpty(), submitReportExtraDataList()
//  definitions                : SUBMIT_DATA_ROLE
//                               EXTRA_DATA_TYPE_STUCK_VALIDATORS, EXTRA_DATA_TYPE_EXITED_VALIDATORS
//                               EXTRA_DATA_FORMAT_EMPTY, EXTRA_DATA_FORMAT_LIST
//  storage slots (state vars) : EXTRA_DATA_PROCESSING_STATE_POSITION
// 
//  1. Cannot initialize() or initializeWithoutMigration() twice
//  2. Cannot initialize() with empty addresses
//  3. verify all the reverting scenarios of submitReportData():
//     a) The caller is not a member of the oracle committee and doesn't possess the SUBMIT_DATA_ROLE.
//     b) The provided contract version is different from the current one.
//     c) The provided consensus version is different from the expected one.
//     d) The provided reference slot differs from the current consensus frame's one.
//     e) The processing deadline for the current consensus frame is missed.
//     f) The keccak256 hash of the ABI-encoded data is different from the last hash provided by the hash consensus contract.
//     g) The provided data doesn't meet safety checks. (in OracleReportSanityChecker.sol)
//  4. If ReportData.extraDataFormat is not EXTRA_DATA_FORMAT_EMPTY=0 or EXTRA_DATA_FORMAT_LIST=1 => revert
//  5. If the oracle report contains no extra data => ReportData.extraDataHash == 0
//  6. If the oracle report contains extra data => ReportData.extraDataHash != 0
//  7. If the oracle report contains no extra data => ReportData.extraDataItemsCount == 0
//  8. If the oracle report contains extra data => ReportData.extraDataItemsCount != 0
//  9. submitReportData(), submitReportExtraDataList(), submitReportExtraDataEmpty
//     can be called only if msg.sender has the appropriate role SUBMIT_DATA_ROLE (same as 1a)
//     or if the caller is a member of the oracle committee
// 10. Cannot call submitReport[Data/ExtraDataList/ExtraDataEmpty] twice at the same e.block.timestamp
// 11. Cannot submit the same reports (Data/ExtraDataList/Empty) twice
// 12. Cannot call submitReportExtraDataEmpty() if the report submitted with submitReportData()
//     had report.extraDataFormat != EXTRA_DATA_FORMAT_EMPTY()
// 13. Cannot call submitReportExtraDataList() if the report submitted with submitReportData()
//     had report.extraDataFormat != EXTRA_DATA_FORMAT_LIST()
// 14. New: no function, except submitReportData(), can change the value in LAST_PROCESSING_REF_SLOT_POSITION
//      14. Old: *DON'T INCLUDE IN REPORT* If the reportExtraDataEmpty() was processed you cannot submit again the same previous submitReportData()
//      15. Old: *DON'T INCLUDE IN REPORT* If the reportExtraDataList() was processed you cannot submit again the same previous submitReportData()
//      16. Old: *DON'T INCLUDE IN REPORT* If the reportExtraDataEmpty() was processed you cannot submit new ReportData for the same refSlot
//      17. Old: *DON'T INCLUDE IN REPORT* If the reportExtraDataList() was processed you cannot submit new ReportData for the same refSlot
// 15. The processed refSlot can only increase
// 16. After successfully processing a consensus report, the LastProcessingRefSlot is updated correctly
// 17. Only newer report, pointing to higher refSlot, can be submitted
// 18. Cannot submit a new report without calling the submitReportExtraDataEmpty() / submitReportExtraDataList() first

//  1. Cannot initialize() or initializeWithoutMigration() twice
// Status: Pass - 4s
// https://vaas-stg.certora.com/output/80942/e04fba855b5641f682cb05edb5362213/?anonymousKey=163260b76cb1479de139f7b547b37bea891bfccb
// https://vaas-stg.certora.com/output/80942/1576e3f81f644e2aa7868e3d7413994d/?anonymousKey=c644534aab933aae27ef99c352f2472d5ee331a9
rule cannotInitializeTwice(method f, method g) 
    filtered { f -> f.selector == sig:initialize(address,address,uint256).selector ||
                    f.selector == sig:initializeWithoutMigration(address,address,uint256,uint256).selector,
               g -> g.selector == sig:initialize(address,address,uint256).selector ||
                    g.selector == sig:initializeWithoutMigration(address,address,uint256,uint256).selector}
{    
    require contractAddressesLinked();
    env e; calldataarg args;
    env e2; calldataarg args2;

    f(e,args);
    g@withrevert(e2,args2);

    assert lastReverted;
}

//  2. Cannot initialize() with empty addresses
// Status: Pass - 2s
// https://vaas-stg.certora.com/output/80942/f264880cd2dd4d0381fdaa06a5234879/?anonymousKey=511229de14f62dab5a22416abd33943fb8b5e538
// https://vaas-stg.certora.com/output/80942/a9e75e3eeffd4fa9bc272f6198684705/?anonymousKey=d89d2cd77ddb3476fcef4b09c2fcbe0343cc38ef
// if both directions <=> then status: fail
// https://vaas-stg.certora.com/output/80942/622251a95a63420490af941bc010d4ac/?anonymousKey=ea15d59a3222d319a1c85f86159cc315c4e74695
rule cannotInitializeWithEmptyAddresses() {
    require contractAddressesLinked();
    env e; calldataarg args;
    // require e.msg.value == 0;

    address admin; address consensusContract; uint256 consensusVersion;
    initialize@withrevert(e, admin, consensusContract, consensusVersion);

    assert (admin == 0 || consensusContract == 0) => lastReverted;
}

//  3. verify all the reverting scenarios of submitReportData()
//  4. If ReportData.extraDataFormat is not EXTRA_DATA_FORMAT_EMPTY=0 or EXTRA_DATA_FORMAT_LIST=1 => revert
//  5. If the oracle report contains no extra data => ReportData.extraDataHash == 0
//  6. If the oracle report contains extra data => ReportData.extraDataHash != 0
//  7. If the oracle report contains no extra data => ReportData.extraDataItemsCount == 0
//  8. If the oracle report contains extra data => ReportData.extraDataItemsCount != 0
// Status: Pass - 215s, 288s
// https://vaas-stg.certora.com/output/80942/bd32307a5a324b2881652d1b2258b601/?anonymousKey=b7d045ddc841e27f4a8eea9a7065d7edc0f3ce26
// https://vaas-stg.certora.com/output/80942/fba85056dac447f1ae8f6883d061fb7c/?anonymousKey=fc4c32fb50cb0013bf50194789ad574380099b59
rule correctRevertsOfSubmitReportData() {
    require contractAddressesLinked();
    env e; calldataarg args;

    bool hasSubmitDataRole = hasRole(e,SUBMIT_DATA_ROLE(e),e.msg.sender);
    bool callerIsConsensusMember = isConsensusMember(e,e.msg.sender);

    uint256 currentContractVersion = getContractVersion(e);
    uint256 currentConsensusVersion = getConsensusVersion(e);

    bytes32 currentHash; uint256 currentRefSlot; uint256 currentDeadline; bool processingStarted;
    currentHash, currentRefSlot, currentDeadline, processingStarted = getConsensusReport(e);

    uint256 lastProcessingRefSlot = getLastProcessingRefSlot(e);

    // struct ReportData
    uint256 consensusVersion; uint256 refSlot;
    // uint256 numValidators; uint256 clBalanceGwei;
    // uint256[] stakingModuleIdsWithNewlyExitedValidators; uint256[] numExitedValidatorsByStakingModule;
    // uint256 withdrawalVaultBalance; uint256 elRewardsVaultBalance;
    //uint256 lastFinalizableWithdrawalRequestId;
    uint256 simulatedShareRate; bool isBunkerMode;
    uint256 extraDataFormat; bytes32 extraDataHash; uint256 extraDataItemsCount;

    uint256 contractVersion;

    bytes32 submittedHash = helperCreateAndSubmitReportData@withrevert( e,
                                consensusVersion, refSlot,
                                simulatedShareRate, isBunkerMode,
                                extraDataFormat, extraDataHash, extraDataItemsCount,
                                contractVersion );
    
    bool submitReverted = lastReverted;

    assert (!hasSubmitDataRole && !callerIsConsensusMember) => submitReverted;  // case 3a
    assert (contractVersion != currentContractVersion)      => submitReverted;  // case 3b
    assert (consensusVersion != currentConsensusVersion)    => submitReverted;  // case 3c
    assert (refSlot != currentRefSlot)                      => submitReverted;  // case 3d
    assert (e.block.timestamp > currentDeadline)            => submitReverted;  // case 3e
    assert (submittedHash != currentHash)                   => submitReverted;  // case 3f

    assert (extraDataFormat != EXTRA_DATA_FORMAT_EMPTY() &&
            extraDataFormat != EXTRA_DATA_FORMAT_LIST())    => submitReverted;  // case 4
    
    assert (extraDataFormat == EXTRA_DATA_FORMAT_EMPTY() && 
            extraDataHash != to_bytes32(0))                             => submitReverted;  // case 5
    
    assert (extraDataFormat == EXTRA_DATA_FORMAT_LIST() && 
            extraDataHash == to_bytes32(0))                             => submitReverted;  // case 6
    
    assert (extraDataFormat == EXTRA_DATA_FORMAT_EMPTY() && 
            extraDataItemsCount != 0)                       => submitReverted;  // case 7
    
    assert (extraDataFormat == EXTRA_DATA_FORMAT_LIST() && 
            extraDataItemsCount == 0)                       => submitReverted;  // case 8
}

//  9. submitReportData(), submitReportExtraDataList(), submitReportExtraDataEmpty
//     can be called only if msg.sender has the appropriate role SUBMIT_DATA_ROLE (same as 3a)
//     or if the caller is a member of the oracle committee
// Status: Pass - 14s
// https://vaas-stg.certora.com/output/80942/f4905a42c92847038aa32718403b9c8a/?anonymousKey=7bd858eae6586c20777b7c372fa7dec65ce0ed87
// https://vaas-stg.certora.com/output/80942/6505311ebf334498b4b6529c5deeac27/?anonymousKey=2f4ee14a6a7541a49e16d5b4d6f3fb14bf98c4de

//// ERROR: this rule does not compile, issue with sig:submitReportData
// rule callerMustHaveSubmitDataRoleOrBeAConsensusMember(method f) 
//     filtered { f -> f.selector == sig:submitReportData((uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256),uint256).selector ||
//                     f.selector == sig:submitReportExtraDataList(bytes).selector ||
//                     f.selector == sig:submitReportExtraDataEmpty().selector }
// {    
//     require contractAddressesLinked();
//     env e; calldataarg args;

//     bool hasSubmitDataRole = hasRole(e,SUBMIT_DATA_ROLE(),e.msg.sender);
//     bool callerIsConsensusMember = isConsensusMember(e,e.msg.sender);

//     f(e,args);

//     assert (!hasSubmitDataRole && !callerIsConsensusMember) => lastReverted;
// }

/*
// 10. Cannot call submitReport[Data/ExtraDataList/ExtraDataEmpty] twice at the same e.block.timestamp
// Status: Pass - 2144s, 3328s, 645s
// https://vaas-stg.certora.com/output/80942/a468b233b03f4f8d8382141d1d0a6eb6/?anonymousKey=f2e33c53956a1dea740d260ea93a234b0fdc8af4
// https://vaas-stg.certora.com/output/80942/19f033eb8f694479a32b2c8178f9d6f6/?anonymousKey=6332eb4266f91e455a3e94b6b6782f761dda59eb
// https://vaas-stg.certora.com/output/80942/afae22c1cabb47b28127102fb008f439/?anonymousKey=604cdc6850fdb6dd9a1b6be7d78cc8d41b2aee08
rule cannotSubmitReportDataTwiceAtSameTimestamp(method f) 
    filtered { f -> f.selector == submitReportData((uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256),uint256).selector ||
                    f.selector == sig:submitReportExtraDataList(bytes).selector ||
                    f.selector == sig:submitReportExtraDataEmpty().selector }
{    
    require contractAddressesLinked();
    env e; calldataarg args; env e2; calldataarg args2;

    // require e.block.timestamp == e2.block.timestamp;

    f(e,args);              // successfully submit a report at time == e.block.timestamp
    f@withrevert(e2,args2); // same e.block.timestamp, any calldataarg (i.e., any report)

    // assert lastReverted;
    assert (e.block.timestamp == e2.block.timestamp) => lastReverted;
}
*/

/*
// 11. Cannot submit the same reports (Data/ExtraDataList/Empty) twice
// Status: Pass - 200s, 3350s
// https://vaas-stg.certora.com/output/80942/5ec12c1b2b8c4af8bf4cfd1edae6d148/?anonymousKey=a879498440112f8ef21cf466bfbf9579cc4e3002
// https://vaas-stg.certora.com/output/80942/06ea4698bf6a463e801a45774375007d/?anonymousKey=f0bd8aae38c8529b79a60367f67214a7f6ce0c2a
rule cannotSubmitTheSameReportDataTwice(method f) 
    filtered { f -> f.selector == submitReportData((uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256),uint256).selector ||
                    f.selector == sig:submitReportExtraDataList(bytes).selector ||
                    f.selector == sig:submitReportExtraDataEmpty().selector }
{    
    require contractAddressesLinked();
    env e; calldataarg args; env e2;

    f(e,args);              // successfully submit a report at time == e.block.timestamp
    f@withrevert(e2,args);  // time can be anytime e.2block.timestamp, but the SAME calldataarg (report)

    assert lastReverted;
}
*/

/*
// 12. Cannot call submitReportExtraDataEmpty() if the report submitted with submitReportData()
//     had report.extraDataFormat != EXTRA_DATA_FORMAT_EMPTY()
// Status: Pass without extra asserts - 83s
// https://vaas-stg.certora.com/output/80942/3de063e6c4ef4386a703cc69b5193257/?anonymousKey=b886518a1ceaf175b1b3c553e2976d17ea1b6f77
// Status of new code: Timeout!
// https://vaas-stg.certora.com/output/80942/0810e672cd8c45f4bcd1b779dc49b6a8/?anonymousKey=dbd4dfb550b7691b19e524238e2a4fefe27def92
// Status: Timeouts with extra asserts
// https://vaas-stg.certora.com/output/80942/99847ff728e043d99e3c0f3186c07792/?anonymousKey=d0f44d018c52a17dc9111a28655b8174168d9e2d
rule cannotSubmitReportExtraDataEmptyWhenExtraDataIsNotEmpty() {
    require contractAddressesLinked();
    env e; calldataarg args; env e2;

    uint256 consensusVersion; uint256 refSlot;
    //uint256 lastFinalizableWithdrawalRequestId;
    uint256 simulatedShareRate; bool isBunkerMode;
    uint256 extraDataFormat; bytes32 extraDataHash; uint256 extraDataItemsCount;

    uint256 contractVersion;

    bytes32 submittedHash = helperCreateAndSubmitReportData( e,
                                consensusVersion, refSlot,
                                simulatedShareRate, isBunkerMode,
                                extraDataFormat, extraDataHash, extraDataItemsCount,
                                contractVersion );
    
    submitReportExtraDataEmpty@withrevert(e2);

    bool submitReverted = lastReverted;

    assert (extraDataFormat != EXTRA_DATA_FORMAT_EMPTY())   => submitReverted;
    // assert (extraDataItemsCount != 0)                       => submitReverted;  // causes timeout
    // assert (extraDataHash != 0)                             => submitReverted;  // causes timeout
}
*/

// 13. Cannot call submitReportExtraDataList() if the report submitted with submitReportData()
//     had report.extraDataFormat != EXTRA_DATA_FORMAT_LIST()
// Status: Pass - 91s, 510s
// https://vaas-stg.certora.com/output/80942/c1df39d3d1f0469ab6383267518fc0b9/?anonymousKey=2a9b2bc84f79cd8307c7341583361091fb0b3b0a
// https://vaas-stg.certora.com/output/80942/fc3e2d16b65142ff83ae0c507c47e8b0/?anonymousKey=afd04305f7bd9eea54413e17ef22b4f63885b042
rule cannotSubmitReportExtraDataListWhenExtraDataIsEmpty() {
    require contractAddressesLinked();
    env e; calldataarg args; env e2;

    uint256 consensusVersion; uint256 refSlot;
    //uint256 lastFinalizableWithdrawalRequestId;
    uint256 simulatedShareRate; bool isBunkerMode;
    uint256 extraDataFormat; bytes32 extraDataHash; uint256 extraDataItemsCount;

    uint256 contractVersion;

    bytes32 submittedHash = helperCreateAndSubmitReportData( e,
                                consensusVersion, refSlot,
                                simulatedShareRate, isBunkerMode,
                                extraDataFormat, extraDataHash, extraDataItemsCount,
                                contractVersion );
    
    bytes dataItems;
    submitReportExtraDataList@withrevert(e2, dataItems);

    bool submitReverted = lastReverted;

    assert (extraDataFormat != EXTRA_DATA_FORMAT_LIST())    => submitReverted;
    assert (extraDataItemsCount == 0)                       => submitReverted;
    assert (extraDataHash == to_bytes32(0))                             => submitReverted;
}

// 14. New: no function, except submitReportData(), can change the value in LAST_PROCESSING_REF_SLOT_POSITION
// Status: Pass - 40s
// https://vaas-stg.certora.com/output/80942/a7bbd21f04d84a688c1c3c5288e1563c/?anonymousKey=0eb3200a4c0c8bec41ba4d76415a7678c51bfd57
// https://vaas-stg.certora.com/output/80942/cb61a0fe876a4521939b55a303e114b2/?anonymousKey=6dd866eb6200de89a15e9b6bed79ee083bb735e5

//// ERROR: this rule does not compile, issue with sig:submitReportData
// rule nobodyCanChangeLastProcessingRefSlotExceptSubmitReportData(method f)
//     filtered { f -> f.selector != sig:submitReportData((uint256,uint256,uint256,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256[],uint256,bool,uint256,bytes32,uint256),uint256).selector &&
//                     f.selector != sig:helperCreateAndSubmitReportData(uint256,uint256,uint256,bool,uint256,bytes32,uint256,uint256).selector && 
//                     f.selector != sig:initialize(address,address,uint256).selector &&
//                     f.selector != sig:initializeWithoutMigration(address,address,uint256,uint256).selector }
//                     // filtering the calls to submitReportData()
//                     // and to initializer functions that cannot be called twice
// {
//     require contractAddressesLinked();
//     env e; calldataarg args; env e2; calldataarg args2; env e3;

//     uint256 lastProcessingRefSlotBefore = getLastProcessingRefSlot(e);
//         f(e2,args2);
//     uint256 lastProcessingRefSlotAfter = getLastProcessingRefSlot(e3);

//     assert lastProcessingRefSlotBefore == lastProcessingRefSlotAfter;
// }


// 15. New: The processed refSlot can only increase
// Status: Pass - 35s
// https://vaas-stg.certora.com/output/80942/727a22b111d747c2b79ff2f75669e29f/?anonymousKey=9b484f5aef39cbb662af10826b9cef40a32ef38d
// https://vaas-stg.certora.com/output/80942/2a5a63e7e1604b548d8a4360f64f7f81/?anonymousKey=c41cd2886444f4c0729f23e43c5d0fe2a1564ec7
rule refSlotIsMonotonicallyIncreasing(method f) 
    filtered { f -> f.selector != sig:initialize(address,address,uint256).selector &&
                    f.selector != sig:initializeWithoutMigration(address,address,uint256,uint256).selector }
    // safe filtering as the above methods can be called only once
{
    require contractAddressesLinked();
    env e; env e2; env e3; calldataarg args2;

    uint256 refSlotBefore = getLastProcessingRefSlot(e);
        f(e2,args2);
    uint256 refSlotAfter = getLastProcessingRefSlot(e3);

    assert refSlotBefore <= refSlotAfter;
}

// 16. After successfully processing a consensus report, the LastProcessingRefSlot is updated correctly
// 17. Only newer report, pointing to higher refSlot, can be submitted
// Status: Pass - 10s, 31s
// https://vaas-stg.certora.com/output/80942/94ea622344854a4cbb90860bc11607cd/?anonymousKey=3e2feb3f2d205463e0fa314e0a4dc9f8b93d4e4b
// https://vaas-stg.certora.com/output/80942/1fd259c5677545faba0e56611b3ef15f/?anonymousKey=67a6d901ac04e39402066382cfcf759eae10885b
rule correctUpdateOfLastProcessingRefSlot() {
    require contractAddressesLinked();
    env e; env e2; env e3;

    uint256 lastProcessingRefSlotBefore = getLastProcessingRefSlot(e);

    // Arguments for the new report that will be submitted:
    uint256 consensusVersion_1; uint256 refSlot_1;
    //uint256 lastFinalizableWithdrawalRequestId_1;
    uint256 simulatedShareRate_1; bool isBunkerMode_1;
    uint256 extraDataFormat_1; bytes32 extraDataHash_1; uint256 extraDataItemsCount_1;
    uint256 contractVersion_1;

    // Submit the new report for processing
    bytes32 submittedHash1 = helperCreateAndSubmitReportData( e2,
                                consensusVersion_1, refSlot_1,
                                simulatedShareRate_1, isBunkerMode_1,
                                extraDataFormat_1, extraDataHash_1, extraDataItemsCount_1,
                                contractVersion_1 );

    uint256 lastProcessingRefSlotAfter = getLastProcessingRefSlot(e3);

    assert lastProcessingRefSlotAfter == refSlot_1;                     // rule 16
    assert lastProcessingRefSlotBefore < lastProcessingRefSlotAfter;    // rule 17
}

/*
// 18. Cannot submit a new report without calling the submitReportExtraDataEmpty() / submitReportExtraDataList() first
// Status: Fail - we know that it should fail as there is currently no check that extraData was not submitted
// https://vaas-stg.certora.com/output/80942/3eaa9a099efd4e1fb5b99ab8a4b851ec/?anonymousKey=6acc7a21a75a6c55e103376d7139b40d98fd9753
// Status New Code: Timeout!
// https://vaas-stg.certora.com/output/80942/236847e155de43e88866163355dfac2b/?anonymousKey=7605b191c3db701d3e62bdd2d70f10bf6d6d1f0c
rule cannotSubmitNewReportIfOldWasNotProcessedFirst() {
    require contractAddressesLinked();
    env e; calldataarg args; env e2; calldataarg args2; env e3; calldataarg args3;

    // step 1 - submit a report (#1) to AccountingOracle
    submitReportData(e,args);

    // step 2 - submit the next consensus report (#2) to BaseOracle
    submitConsensusReport(e2,args2);

    // step 3 - submit the next report (#2) to AccountingOracle
    submitReportData@withrevert(e3,args3);

    assert lastReverted;
}
*/



//  rules for BaseOracle.sol:
// ------------------------------------------------------------------------------------------
//  external non-view functions: setConsensusVersion(), setConsensusContract(),
//                               submitConsensusReport()
//  definitions                : MANAGE_CONSENSUS_CONTRACT_ROLE, MANAGE_CONSENSUS_VERSION_ROLE
//  storage slots (state vars) : CONSENSUS_CONTRACT_POSITION, CONSENSUS_VERSION_POSITION
//                               LAST_PROCESSING_REF_SLOT_POSITION, CONSENSUS_REPORT_POSITION
// 
// 1. setConsensusContract() can be called only if msg.sender has the appropriate role
// 2. setConsensusVersion() can be called only if msg.sender has the appropriate role
// 3. Only Consensus contract can submit a report, i.e., call submitConsensusReport()
// 4. Cannot submitConsensusReport() if its refSlot < prevSubmittedRefSlot
// 5. Cannot submitConsensusReport() if its refSlot <= prevProcessingRefSlot
// 6. Cannot submitConsensusReport() if its deadline <= refSlot
// 7. Cannot submitConsensusReport() if its reportHash == 0

// 1. setConsensusContract() can be called only if msg.sender has the appropriate role
// Status: Pass - 1s
// https://vaas-stg.certora.com/output/80942/0e9e4a93a81945f3ac7dfc60d531817c/?anonymousKey=506b7ea379db5fed22a8fbdfc81477bedcf25010
// https://vaas-stg.certora.com/output/80942/3a66148fcdf949ce9af14cf7b23848b1/?anonymousKey=77f7b6f6465c333037d2668d9c71b750a94ca497
rule onlyManagerCanSetConsensusContract() {
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleManager = MANAGE_CONSENSUS_CONTRACT_ROLE(e);
    bool isManager = hasRole(e,roleManager,e.msg.sender);

    bytes32 roleAdmin = getRoleAdmin(e,roleManager);
    bool isAdmin = hasRole(e,roleAdmin,e.msg.sender);

    address newAddress;
    setConsensusContract@withrevert(e,newAddress);

    assert (!isManager && !isAdmin) => lastReverted;
}

// 2. setConsensusVersion() can be called only if msg.sender has the appropriate role
// Status: Pass - 0s
// https://vaas-stg.certora.com/output/80942/1dd3d3d2456441e5a4cb474b5f933881/?anonymousKey=250fe9c13081828347aaf5dedd477bb59f467554
// https://vaas-stg.certora.com/output/80942/48402b95760449df8ee219a8e6a030ad/?anonymousKey=8f127747a4b911b234b61d3fd7ad793a5e4954b5
rule onlyManagerCanSetConsensusVersion() {
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleManager = MANAGE_CONSENSUS_VERSION_ROLE(e);
    bool isManager = hasRole(e,roleManager,e.msg.sender);

    bytes32 roleAdmin = getRoleAdmin(e,roleManager);
    bool isAdmin = hasRole(e,roleAdmin,e.msg.sender);

    uint256 newVersion;
    setConsensusVersion@withrevert(e,newVersion);

    assert (!isManager && !isAdmin) => lastReverted;
}

// 3. Only Consensus contract can submit a report, i.e., call submitConsensusReport()
// Status: Pass - 0s
// https://vaas-stg.certora.com/output/80942/12dc1ba7763b43a09054482acefef5e1/?anonymousKey=e3f6b40b6a126e42a5784249629cb5fc700c3cc2
// https://vaas-stg.certora.com/output/80942/83f3574ced834d3e8c126df4d8926798/?anonymousKey=070c04f81aba14c529d24795bb2d821fda662208
rule onlyConsensusContractCanSubmitConsensusReport(method f) 
    filtered { f -> f.selector == sig:submitConsensusReport(bytes32,uint256,uint256).selector }
{    
    require contractAddressesLinked();
    env e; calldataarg args;

    f@withrevert(e,args);

    assert (e.msg.sender != ConsensusContract) => lastReverted;
}

// 4. Cannot submitConsensusReport() if its refSlot < prevSubmittedRefSlot
// Status: Pass - 0s
// https://vaas-stg.certora.com/output/80942/d3493f0f47a544d086086b793689841c/?anonymousKey=e0006776f21a9ac59c4745a93d0a7e854c7c4e9a
// https://vaas-stg.certora.com/output/80942/b8d6dd347968456fb9f4522c7d561be8/?anonymousKey=4c8c63d2955006d785feca93d58e27f0d502183f
// https://vaas-stg.certora.com/output/80942/a925483a849c45bd9dbd3190d0988522/?anonymousKey=c01198df689c51c9a6704b74ccd95f54407d538a
rule refSlotCannotDecrease() {    
    require contractAddressesLinked();
    env e; calldataarg args;  

    bytes32 prevSubmittedHash; uint256 prevSubmittedRefSlot;
    uint256 prevSubmittedDeadline; bool processingStarted;
    prevSubmittedHash, prevSubmittedRefSlot, prevSubmittedDeadline, processingStarted = getConsensusReport(e);

    bytes32 reportHash; uint256 refSlot; uint256 deadline;
    submitConsensusReport@withrevert(e, reportHash, refSlot, deadline);

    assert (refSlot < prevSubmittedRefSlot) => lastReverted;
}

// 5. Cannot submitConsensusReport() if its refSlot <= prevProcessingRefSlot
// As mentioned in IReportAsyncProcessor imported from HashConsensus.sol
// Status: Pass - 1s
// https://vaas-stg.certora.com/output/80942/ea835481700b428aa37c1b82b1ccac33/?anonymousKey=8f394d9d34b1bda2b007f90b7897952c5400a2f0
// https://vaas-stg.certora.com/output/80942/f6ace268a6d94802950151894d67c4b1/?anonymousKey=61e3d76cfb36d64050012e13670250d199fa2dd0
rule refSlotMustBeGreaterThanProcessingOne() {    
    require contractAddressesLinked();
    env e; calldataarg args;

    uint256 lastProcessingRefSlot = getLastProcessingRefSlot(e);
    
    bytes32 reportHash; uint256 refSlot; uint256 deadline;
    submitConsensusReport@withrevert(e, reportHash, refSlot, deadline);

    assert (refSlot <= lastProcessingRefSlot) => lastReverted;
}

// 6. Cannot submitConsensusReport() if its deadline <= refSlot
// This rule is WRONG as deadline and refslot have different units!
// Status: Fail
// https://vaas-stg.certora.com/output/80942/8c323c10f71b4dafb6b754ba1a4ec865/?anonymousKey=e4b06b987f42ac8c5f9088aa491740d37b475bde
// https://vaas-stg.certora.com/output/80942/4f3ac84949c14afea84d5bd8ef835381/?anonymousKey=d059554256a0a66cd93956bfb544df80c2d0debf
// rule deadlineMustBeAfterRefSlotBaseOracle() {    
//     require contractAddressesLinked();
//     env e; calldataarg args;
    
//     bytes32 reportHash; uint256 refSlot; uint256 deadline;
//     submitConsensusReport@withrevert(e,reportHash, refSlot, deadline);

//     assert (deadline <= refSlot) => lastReverted;
// }

/*
// 7. Cannot submitConsensusReport() if its reportHash == 0
// Status: Fail
// https://vaas-stg.certora.com/output/80942/430b70d788dd453eae3647ac444f9cad/?anonymousKey=9f16b9986826770acb548c758fa681767ed4cabf
// https://vaas-stg.certora.com/output/80942/9a20e9f21a0d496a9e41888c3a466f6d/?anonymousKey=c6b8d3da844e4d730dcceaadd0c9f5750c01873c
rule reportHashCannotBeZero() {    
    require contractAddressesLinked();
    env e; calldataarg args;
    
    bytes32 reportHash; uint256 refSlot; uint256 deadline;
    submitConsensusReport@withrevert(e,reportHash, refSlot, deadline);

    assert (reportHash == 0) => lastReverted;
}
*/



//  rules for AccessControlEnumerable.sol
// ------------------------------------------------------------------------------------------
// 1. adding a new role member with roleR should *increase* the count of getRoleMemberCount(roleR) by one
// 2. removing a roleR from a member should *decrease* the count of getRoleMemberCount(roleR) by one
// 3. getRoleMemberCount(roleX) should not be affected by adding or removing roleR (roleR != roleX)

// 1. adding a new role member with roleR should *increase* the count of getRoleMemberCount(roleR) by one
// Status: Old: Pass
// Old: https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// Status: New: Pass - 0s
// New: https://vaas-stg.certora.com/output/80942/3407af04b4844c2c9eb4b7f96f929846/?anonymousKey=8ba5d954259341810fa2c5676001cc22eee4e999
// https://vaas-stg.certora.com/output/80942/fc9d7a418fd44d9284aba83e6815e755/?anonymousKey=69b898eb12bc56c1f98156e731ad816f2b1a5702
rule countIncreaseByOneWhenGrantRole(/*method f*/) {
    require contractAddressesLinked();
    env e; calldataarg args;
    
    bytes32 roleR; address accountA;

    renounceRole(e,roleR,accountA); // ensure accountA does not have roleR

    bool hasRoleRAccountABefore = hasRole(e,roleR,accountA);
    uint256 countRoleRMembersBefore = getRoleMemberCount(e,roleR);
    require countRoleRMembersBefore < UINT256_MAX();  // reasonable there are not so many role members

    grantRole(e,roleR,accountA);
    // f(e,args);  //old

    bool hasRoleRAccountAAfter = hasRole(e,roleR,accountA);
    uint256 countRoleRMembersAfter = getRoleMemberCount(e,roleR);

    assert countRoleRMembersAfter == require_uint256(countRoleRMembersBefore + 1); // new

    //assert (hasRoleRAccountABefore && !hasRoleRAccountAAfter) => countRoleRMembersBefore - countRoleRMembersAfter == 1; // old
}

// 2. removing a roleR from a member should *decrease* the count of getRoleMemberCount(roleR) by one
// Status: Old: Pass
// Old: https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// Status: New: Pass - 0s
// https://vaas-stg.certora.com/output/80942/fa6bd7a1c03c4e3994b792e50a44ac51/?anonymousKey=e6580b3e50550e85539f57773742057ff99ed81e
// https://vaas-stg.certora.com/output/80942/14b59a4964674f6eac2c2a9df06ad138/?anonymousKey=b4273467801b8245bc91f7033d5746164bb22cfe
rule countDecreaseByOneWhenRenounceRole(/*method f*/) {
    require contractAddressesLinked();
    env e; calldataarg args;
    
    bytes32 roleR; address accountA;

    grantRole(e,roleR,accountA); // ensure accountA has roleR

    bool hasRoleRAccountABefore = hasRole(e,roleR,accountA);
    uint256 countRoleRMembersBefore = getRoleMemberCount(e,roleR);
    require countRoleRMembersBefore > 0;  // there is at least one account with roleR
    
    renounceRole(e,roleR,accountA); // new
    // f(e,args); // old

    bool hasRoleRAccountAAfter = hasRole(e,roleR,accountA);
    uint256 countRoleRMembersAfter = getRoleMemberCount(e,roleR);

    assert countRoleRMembersAfter == require_uint256(countRoleRMembersBefore - 1); // new

    //assert (hasRoleRAccountABefore && !hasRoleRAccountAAfter) => countRoleRMembersBefore - countRoleRMembersAfter == 1; // old
}

// 3. getRoleMemberCount(roleX) should not be affected by adding or removing roleR (roleR != roleX)
// If a member with roleR was added/removed, the count of members with roleX != roleR should not change
// Status: Pass - 225s
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// https://vaas-stg.certora.com/output/80942/ec8c86059df946deaa39f873fca99478/?anonymousKey=a334119127856f37747b09d086b5f9f78088361d
rule memberCountNonInterference(method f) {
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleR; bytes32 roleX;

    uint256 countRoleRMembersBefore = getRoleMemberCount(e,roleR);
    uint256 countRoleXMembersBefore = getRoleMemberCount(e,roleX);

    f(e,args);

    uint256 countRoleRMembersAfter = getRoleMemberCount(e,roleR);
    uint256 countRoleXMembersAfter = getRoleMemberCount(e,roleX);

    require roleR != roleX;
    
    assert (countRoleRMembersAfter > countRoleRMembersBefore) =>
            countRoleXMembersAfter == countRoleXMembersBefore;

    assert (countRoleRMembersAfter < countRoleRMembersBefore) =>
            countRoleXMembersAfter == countRoleXMembersBefore;
}



//  rules for AccessControl.sol:
// ------------------------------------------------------------------------------------------
// 1. only admin of role R can grant the role R to the account A (role R can be any role including the admin role)
// 2. only admin or the account A itself can revoke the role R of account A (no matter the role)
// 3. granting or revoking roleR from accountA should not affect any accountB

// 1. only admin of role R can grant the role R to the account A (role R can be any role including the admin role)
// Status: Fails only on initialize() and initializeWithoutMigration() which can only be called once, so we can filter them
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// Status: Pass - 141s
// https://vaas-stg.certora.com/output/80942/e4baa987a34240d18a2531301e772a53/?anonymousKey=231eba328d8c01c657a6494688b8d9eb1ba1368d
// https://vaas-stg.certora.com/output/80942/40181ff94c0044d3bd7bc4cd08a6bb35/?anonymousKey=0e44858821dd122ffae3b0c3030e17bd2dd95cfc
rule onlyAdminCanGrantRole(method f)
    filtered { f -> f.selector != sig:initialize(address,address,uint256).selector &&
                    f.selector != sig:initializeWithoutMigration(address,address,uint256,uint256).selector }
    // safe filtering as the above methods can be called only once
{
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleR; address accountA;
    bool hasRoleRBefore = hasRole(e,roleR,accountA);

    bytes32 roleRAdmin = getRoleAdmin(e,roleR);
    bool isAdmin = hasRole(e,roleRAdmin,e.msg.sender);

    f(e,args);

    bool hasRoleRAfter = hasRole(e,roleR,accountA);

    assert (!hasRoleRBefore && hasRoleRAfter) => (isAdmin); 
}

// 2. only admin or the account A itself can revoke the role R of account A (no matter the role)
// Status: Pass - 187s
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// https://vaas-stg.certora.com/output/80942/827fd21f3f0c49808e5f78b312b1aca3/?anonymousKey=b2012671c109df023ca9304a46a8f7dda18c4625
rule onlyAdminOrSelfCanRevokeRole(method f) {
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleR; address accountA;
    bool hasRoleRBefore = hasRole(e,roleR,accountA);

    bytes32 roleRAdmin = getRoleAdmin(e,roleR);
    bool isAdmin = hasRole(e,roleRAdmin,e.msg.sender);

    f(e,args);

    bool hasRoleRAfter = hasRole(e,roleR,accountA);

    assert (hasRoleRBefore && !hasRoleRAfter) => (isAdmin || e.msg.sender == accountA); 
}

// 3. granting or revoking roleR from accountA should not affect any accountB
// Status: Pass - 251s
// Note: had to comment line 315 in BaseOracle.sol (to resolve the getProcessingState() dispatcher problem)
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
// https://vaas-stg.certora.com/output/80942/7e0a2b36f4af4a6b8d395f1d29618532/?anonymousKey=ab60c76b12f88d371cfb3eacb95e4097a4f3e88f
rule nonInterferenceOfRolesAndAccounts(method f) {
    require contractAddressesLinked();
    env e; calldataarg args;

    bytes32 roleR; address accountA;
    bytes32 roleX; address accountB;

    bool hasRoleRAccountABefore = hasRole(e,roleR,accountA);
    bool hasRoleXAccountBBefore = hasRole(e,roleX,accountB);

    f(e,args);

    bool hasRoleRAccountAAfter = hasRole(e,roleR,accountA);
    bool hasRoleXAccountBAfter = hasRole(e,roleX,accountB);

    require (roleR != roleX) && (accountA != accountB);

    assert (!hasRoleRAccountABefore && hasRoleRAccountAAfter) =>                // if roleR was granted to AccountA
                (   (hasRoleXAccountBBefore && hasRoleXAccountBAfter)   ||      // then NO change of RoleX
                   (!hasRoleXAccountBBefore && !hasRoleXAccountBAfter)    );    //      of AccountB
    
    assert (hasRoleRAccountABefore && !hasRoleRAccountAAfter) =>                // if roleR was revoked from AccountA
                (   (hasRoleXAccountBBefore && hasRoleXAccountBAfter)   ||      // then NO change of RoleX
                   (!hasRoleXAccountBBefore && !hasRoleXAccountBAfter)     );   //      of AccountB
}



/**************************************************
 *                   MISC Rules                   *
 **************************************************/

// Status: Fails (as expected, no issues)
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
rule sanity(method f) 
//filtered { f -> !f.isView }
{
    require contractAddressesLinked();
    env e; calldataarg args;

    f(e,args);
    assert false;
}
