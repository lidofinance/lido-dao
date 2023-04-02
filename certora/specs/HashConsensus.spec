/**************************************************
 *               Methods Declaration              *
 **************************************************/
methods {
    submitConsensusReport(bytes32 report, uint256 refSlot, uint256 deadline) => NONDET
    getLastProcessingRefSlot() returns (uint256) => NONDET
    getConsensusVersion() returns (uint256) => NONDET
}

/**************************************************
 *                CVL FUNCS & DEFS                *
 **************************************************/
function saneTimeConfig() {
    env e0; calldataarg args0;

    require e0.msg.value == 0;                       // view functions revert is you send eth
    require e0.block.timestamp > 1672531200;         // 01.01.2023 00:00:00
    require e0.block.timestamp < 2524608000;         // 01.01.2050 00:00:00

    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e0);

    require slotsPerEpoch == 32;                    // simplification, must be required at constructor
    require secondsPerSlot == 12;                   // simplification, must be required at constructor
    require genesisTime < e0.block.timestamp;       // safe assumption, must be required at constructor

    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e0);
    require epochsPerFrame > 0;                     // constructor already ensures this
    require epochsPerFrame < 31536000;              // assuming less than 1 year per frame

    // assuming correct configuration of the frame, otherwise revert
    require initialEpoch < (e0.block.timestamp - genesisTime) / (secondsPerSlot * slotsPerEpoch);
    require initialEpoch > 0;    
}

definition UINT64_MAX() returns uint64 = 0xFFFFFFFFFFFFFFFF;
definition UINT256_MAX() returns uint256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

// definition DEFAULT_ADMIN_ROLE() returns bytes32 = 0x00;
definition MANAGE_MEMBERS_AND_QUORUM_ROLE() returns bytes32 = 0x66a484cf1a3c6ef8dfd59d24824943d2853a29d96f34a01271efc55774452a51; //keccak256("MANAGE_MEMBERS_AND_QUORUM_ROLE");
definition DISABLE_CONSENSUS_ROLE() returns bytes32 = 0x10b016346186602d93fc7a27ace09ba944baf9453611b186d36acd3d3d667dc0; //keccak256("DISABLE_CONSENSUS_ROLE");
definition MANAGE_FRAME_CONFIG_ROLE() returns bytes32 = 0x921f40f434e049d23969cbe68d9cf3ac1013fbe8945da07963af6f3142de6afe; //keccak256("MANAGE_FRAME_CONFIG_ROLE");
definition MANAGE_FAST_LANE_CONFIG_ROLE() returns bytes32 = 0x4af6faa30fabb2c4d8d567d06168f9be8adb583156c1ecb424b4832a7e4d6717; //keccak256("MANAGE_FAST_LANE_CONFIG_ROLE");
definition MANAGE_REPORT_PROCESSOR_ROLE() returns bytes32 = 0xc5219a8d2d0107a57aad00b22081326d173df87bad251126f070df2659770c3e; //keccak256("MANAGE_REPORT_PROCESSOR_ROLE");
// definition MANAGE_CONSENSUS_CONTRACT_ROLE() returns bytes32 = 0x04a0afbbd09d5ad397fc858789da4f8edd59f5ca5098d70faa490babee945c3b; //keccak256("MANAGE_CONSENSUS_CONTRACT_ROLE");
// definition MANAGE_CONSENSUS_VERSION_ROLE() returns bytes32 = 0xc31b1e4b732c5173dc51d519dfa432bad95550ecc4b0f9a61c2a558a2a8e4341; //keccak256("MANAGE_CONSENSUS_VERSION_ROLE");
// definition SUBMIT_DATA_ROLE() returns bytes32 = 0x65fa0c17458517c727737e4153dd477fa3e328cf706640b0f68b1a285c5990da; //keccak256("SUBMIT_DATA_ROLE");
definition UNREACHABLE_QUORUM() returns uint256 = max_uint256; // type(uint256).max
definition ZERO_HASH() returns bytes32 = 0; // bytes32(0)


// rule ideas for HashConsensus (without inheritance):
// ------------------------------------------------------------------------------------------
//  external non-view functions: setFrameConfig(), setFastLaneLengthSlots(), addMember(), removeMember(),
//                               setQuorum(), disableConsensus(), setReportProcessor(), submitReport()
//  external view functions    : getChainConfig(), getFrameConfig(), getCurrentFrame(),
//                               getIsMember(), getIsFastLaneMember(), getMembers(), getFastLaneMembers(),
//                               getQuorum(), getConsensusState(), getReportVariants(), getConsensusStateForMember()
//  definitions                : MANAGE_MEMBERS_AND_QUORUM_ROLE
//                               DISABLE_CONSENSUS_ROLE, MANAGE_FRAME_CONFIG_ROLE,
//                               MANAGE_FAST_LANE_CONFIG_ROLE, MANAGE_REPORT_PROCESSOR_ROLE,
//                               SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME,
//                               UNREACHABLE_QUORUM, ZERO_HASH
//  storage slots (state vars) : _frameConfig, _memberStates, _memberAddresses, _memberIndices1b,
//                               _reportingState, _quorum, _reportVariants, _reportVariantsLength,
//                               _reportProcessor

//  1. All the external view functions cannot revert under any circumstance,
//     especially getCurrentFrame() as it is used by LegacyOracle and BaseOracle
//  2. Only ACL roles can call the external non-view functions:
//      setFrameConfig() - MANAGE_FRAME_CONFIG_ROLE 
//      setFastLaneLengthSlots() - MANAGE_FAST_LANE_CONFIG_ROLE
//      addMember() - MANAGE_MEMBERS_AND_QUORUM_ROLE
//      removeMember() - MANAGE_MEMBERS_AND_QUORUM_ROLE
//      setQuorum() - MANAGE_MEMBERS_AND_QUORUM_ROLE, DISABLE_CONSENSUS_ROLE (only if disabling it)
//      disableConsensus() - MANAGE_MEMBERS_AND_QUORUM_ROLE, DISABLE_CONSENSUS_ROLE
//      setReportProcessor() - MANAGE_REPORT_PROCESSOR_ROLE
//      submitReport() - only if getIsMember(msg.sender) == true
//  3. setFrameConfig() updates epochsPerFrame in a way that either keeps the current reference slot
//     the same or increases it by at least the minimum of old and new frame sizes
//  4. setFastLaneLengthSlots() works as expected, setting it to zero disables the fast lane subset
//     verify with getFrameConfig() and check that fastLaneLengthSlots < frameConfig.epochsPerFrame * SLOTS_PER_EPOCH
//  5. addMember() - cannot add an existing member
//  6. addMember() - cannot add an empty address as a member
//  7, addMember() - adding a member does not remove any other member
//  8. addMember() - adding a member increases the total members by 1
//  9. removeMember() - cannot remove a member that does not exists - reverts
// 10. removeMember() - removing a member does not remove any other member
// 11. removeMember() - removing a member decreases the total members by 1
// 12. setQuorum() - acts as expectedly, verified by getQuorum()
// 13. disableConsensus() - acts as expectedly, verified by getQuorum()
// 14. setReportProcessor() - cannot set an empty address
// 15. submitReport() - slot > max_uint64 => revert
// 16. submitReport() - slot < currentRefSlot => revert
// 17. submitReport() - slot <= lastProcessingRefSlot => revert
// 18. submitReport() - reportHash == 0 => revert
// 19. submitReport() - consensusVersion != getConsensusVersion() => revert
// 20. submitReport() - verify that _computeTimestampAtSlot(frame.reportProcessingDeadlineSlot) > TimeOf(frame.refSlot)
//                             that the deadline is explicitly == TimeOf(refslot+FrameSize)
// 21. submitReport() - revert if same oracle reports the same slot+hash (cannot double vote for same report)
// 22. submitReport() - single call to submit report increases only one support for one variant
//                      sum of supports of all variants < total members,
//                      because if Oracle member changes its mind, its previous support is removed
// 23. submitReport() - all variants should be removed when new frame starts


//  1. All the external view functions cannot revert under any circumstance,
//     especially getCurrentFrame() as it is used by LegacyOracle and BaseOracle
// Status: Fail
// https://vaas-stg.certora.com/output/80942/985192ce8baf4725a8b6d29c1d0dc2af/?anonymousKey=f2574e5803ece9f5b8d734ecd68b1d9ac714c1d5
rule viewFunctionsDoNotRevert(method f)
    filtered { f -> f.isView }
{
    env e; calldataarg args;

    require e.msg.value == 0; // view functions revert is you send eth

    f@withrevert(e,args);
    assert !lastReverted;
}

/// POTENTIAL ISSUE: SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME can all be set to zero at constructor
/// if the above are zero => getCurrentFrame() will revert
// focus only on getCurrentFrame() and verify it does not revert
// Status: Timeout! (without simplification)
// https://vaas-stg.certora.com/output/80942/899cc6d765c7467c9e2af018ccca2ca5/?anonymousKey=ca1152175e66f3e61e7d2bffaded5098c62c3bbe
// Status: Pass (with simplification)
// https://vaas-stg.certora.com/output/80942/01ca967565ee4fc58101e7037160aaa1/?anonymousKey=fd302ac936356aa223eb706d466eeae5de7a155f
rule getCurrentFrameDoesNotRevert() {
    env e; calldataarg args;

    require e.msg.value == 0;                       // view functions revert is you send eth
    require e.block.timestamp > 1672531200;         // 01.01.2023 00:00:00
    require e.block.timestamp < 2524608000;         // 01.01.2050 00:00:00

    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e);

    require slotsPerEpoch > 0;                      // must be required at constructor
    require slotsPerEpoch == 1;                     // simplification
    require secondsPerSlot > 0;                     // must be required at constructor
    require secondsPerSlot == 1;                    // simplification
    require genesisTime < e.block.timestamp;        // must be required at constructor

    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e);
    require epochsPerFrame > 0;                     // constructor already ensures this
    require epochsPerFrame < 31536000;              // assuming less than 1 year per frame

    // assuming correct configuration of the frame, otherwise revert
    require initialEpoch < (e.block.timestamp - genesisTime) / (secondsPerSlot * slotsPerEpoch);
    require initialEpoch > 0;                       // must be required at constructor
    // If initialEpoch == 0: revert! (line 545 in HashConsensus.sol), see run below:
    // https://vaas-stg.certora.com/output/80942/8b0204bf08e141d88d92e71d7e2bc653/?anonymousKey=f687713b6e337e389628a70e970ec0dc47477838

    // _computeSlotAtTimestamp:    (timestamp - GENESIS_TIME) / SECONDS_PER_SLOT
    // _computeEpochAtSlot:        slot / SLOTS_PER_EPOCH;

    getCurrentFrame@withrevert(e,args);
    assert !lastReverted;
}

//  2. Only ACL roles can call the external non-view functions:
//      setFrameConfig() - MANAGE_FRAME_CONFIG_ROLE 
//      setFastLaneLengthSlots() - MANAGE_FAST_LANE_CONFIG_ROLE
//      addMember() - MANAGE_MEMBERS_AND_QUORUM_ROLE
//      removeMember() - MANAGE_MEMBERS_AND_QUORUM_ROLE
//      setQuorum() - MANAGE_MEMBERS_AND_QUORUM_ROLE, DISABLE_CONSENSUS_ROLE (only if disabling it)
//      disableConsensus() - MANAGE_MEMBERS_AND_QUORUM_ROLE, DISABLE_CONSENSUS_ROLE
//      setReportProcessor() - MANAGE_REPORT_PROCESSOR_ROLE
//      submitReport() - only if getIsMember(msg.sender) == true
// Status: Fail (partially) because some functions can be called by more than one role
// The verification will be done per function in separate rules
// https://vaas-stg.certora.com/output/80942/b0aebafd7b554b3882fe688da319b9ba/?anonymousKey=4361d0b5bbd895ea4d92beeb16e0deda7cd095c7
rule onlyAllowedRoleCanCallMethod(method f) 
    filtered { f -> !f.isView }
{
    env e; calldataarg args;

    bytes32 roleR;
    bool hasRoleR = hasRole(e,roleR,e.msg.sender);
    require hasRoleR == false;

    bytes32 roleRAdmin = getRoleAdmin(e,roleR);
    bool isAdmin = hasRole(e,roleRAdmin,e.msg.sender);
    require isAdmin == false;

    bool isMember = getIsMember(e,e.msg.sender);
    require isMember == false;

    f@withrevert(e,args);
    bool callReverted = lastReverted;

    assert ((f.selector == setFrameConfig(uint256,uint256).selector) &&
            roleR == MANAGE_FRAME_CONFIG_ROLE()) => lastReverted;
    
    assert ((f.selector == setFastLaneLengthSlots(uint256).selector) &&
            roleR == MANAGE_FAST_LANE_CONFIG_ROLE()) => lastReverted;
    
    assert ((f.selector == addMember(address,uint256).selector) &&
            roleR == MANAGE_MEMBERS_AND_QUORUM_ROLE()) => lastReverted;
    
    assert ((f.selector == removeMember(address,uint256).selector) &&
            roleR == MANAGE_MEMBERS_AND_QUORUM_ROLE()) => lastReverted;

    assert ((f.selector == setQuorum(uint256).selector) &&
            roleR == MANAGE_MEMBERS_AND_QUORUM_ROLE()) => lastReverted;
    
    assert ((f.selector == disableConsensus().selector) &&
            roleR == MANAGE_MEMBERS_AND_QUORUM_ROLE()) => lastReverted;
    
    assert ((f.selector == setReportProcessor(address).selector) &&
            roleR == MANAGE_REPORT_PROCESSOR_ROLE()) => lastReverted;
    
    assert (f.selector == submitReport(uint256,bytes32,uint256).selector) => lastReverted;

    //assert (!hasRoleRBefore && hasRoleRAfter) => (isAdmin); 
}


// 3a. setFrameConfig() ACL check
// Status: Pass
// https://vaas-stg.certora.com/output/80942/af309b535e244a3ca748f0b80f4f301c/?anonymousKey=a0280547905d76770006b8415c1340d089a21f75
rule setFrameConfigACL() {
    env e; calldataarg args;

    bytes32 roleR = MANAGE_FRAME_CONFIG_ROLE();
    bool hasRoleR = hasRole(e,roleR,e.msg.sender);

    bytes32 roleRAdmin = getRoleAdmin(e,roleR);
    bool isAdmin = hasRole(e,roleRAdmin,e.msg.sender);

    uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    setFrameConfig@withrevert(e, epochsPerFrame, fastLaneLengthSlots);
    bool callReverted = lastReverted;

    assert (!hasRoleR && !isAdmin) => callReverted;
}

//  3. setFrameConfig() updates epochsPerFrame in a way that either keeps the current reference slot
//     the same or increases it by at least the minimum of old and new frame sizes
// Status: Fails (need to work on)
// https://vaas-stg.certora.com/output/80942/b8aa709fcefc4b2bb039c2513f17ddd6/?anonymousKey=a19462454ae831311d10d01fdd3a7f4dbe331812
rule setFrameConfigCorrectness() {
    saneTimeConfig();           // ensuring sane chainConfig and frameConfig
    env e; calldataarg args;

    // Get state before
    uint256 refSlot1; uint256 reportProcessingDeadlineSlot1;
    refSlot1, reportProcessingDeadlineSlot1 = getCurrentFrame(e);
    
    uint256 initialEpoch1; uint256 epochsPerFrame1; uint256 fastLaneLengthSlots1;
    initialEpoch1, epochsPerFrame1, fastLaneLengthSlots1 = getFrameConfig(e);

    uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    setFrameConfig(e, epochsPerFrame, fastLaneLengthSlots);

    // Get state after
    uint256 refSlot2; uint256 reportProcessingDeadlineSlot2;
    refSlot2, reportProcessingDeadlineSlot2 = getCurrentFrame(e);

    uint256 initialEpoch2; uint256 epochsPerFrame2; uint256 fastLaneLengthSlots2;
    initialEpoch2, epochsPerFrame2, fastLaneLengthSlots2 = getFrameConfig(e);

    // verify getter returns updated values
    assert epochsPerFrame == epochsPerFrame2;
    assert fastLaneLengthSlots == fastLaneLengthSlots2;

    // verify the comment of the function:
    // keeps the current reference slot the same or
    // increases it by at least the minimum of old and new frame sizes
    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e);

    assert (epochsPerFrame2 >= epochsPerFrame1) =>
                (refSlot1 == refSlot2) || (refSlot2 >= refSlot1 + epochsPerFrame1 * slotsPerEpoch);
    
    assert (epochsPerFrame2 <= epochsPerFrame1) =>
                (refSlot1 == refSlot2) || (refSlot2 >= refSlot1 + epochsPerFrame2 * slotsPerEpoch);
}


/**************************************************
 *                   MISC Rules                   *
 **************************************************/

// Status: Fails (as expected, no issues)
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
rule sanity(method f) 
filtered { f -> !f.isView }
{
    //require contractAddressesLinked();
    env e; calldataarg args;

    f(e,args);
    assert false;
}