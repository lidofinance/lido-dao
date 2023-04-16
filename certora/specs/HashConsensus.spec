/**************************************************
 *               Methods Declaration              *
 **************************************************/
methods {
    submitConsensusReport(bytes32 report, uint256 refSlot, uint256 deadline) => CONSTANT
    getLastProcessingRefSlot() returns (uint256) => CONSTANT
    getConsensusVersion() returns (uint256) => CONSTANT

    reportReceivedCounter(uint256 refSlot, address member, bytes32 report) => getSuccessfulReportSubmitEventInfo(refSlot, member, report)
}

/**************************************************
 *                GHOSTS AND HOOKS                *
 **************************************************/
// the three ghost variables below store info about a successful report submit
ghost uint256 ghostReportRefSlot {
    init_state axiom ghostReportRefSlot == 0;
}
ghost address ghostReportMember {
    init_state axiom ghostReportMember == 0;
}
ghost bytes32 ghostReportHash {
    init_state axiom ghostReportHash == 0;
}


/**************************************************
 *                CVL FUNCS & DEFS                *
 **************************************************/
function saneTimeConfig() returns uint256 {         // returns the timestamp when the valid setting are set
    env e0; calldataarg args0;

    uint256 correctInitialEpoch;
    updateInitialEpoch(e0, correctInitialEpoch);    // must be called after constructor

    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e0);
    require slotsPerEpoch == 32;                    // simplification, must be required at constructor
    require secondsPerSlot == 12;                   // simplification, must be required at constructor
    require genesisTime < e0.block.timestamp;       // safe assumption, must be required at constructor

    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e0);
    // uint256 farFutureEpoch = computeEpochAtTimestamp(e0, 0xFFFFFFFFFFFFFFFF); // type(uint64).max
    // require initialEpoch == farFutureEpoch;         // as in constructor (not good! after constructor updateInitialEpoch() should be called)
    require epochsPerFrame > 0;                     // constructor already ensures this
    require epochsPerFrame < 31536000;              // assuming less than 1 year per frame
    require epochsPerFrame == 86400;                // simplification: Frame = 1 day = 24 * 60 * 60 seconds

    require initialEpoch < ((e0.block.timestamp - genesisTime) / (secondsPerSlot * slotsPerEpoch)); // sane configuration of initialEpoch

    return e0.block.timestamp;
}

// A helper function to get event info of successful report submit
function getSuccessfulReportSubmitEventInfo(uint256 refSlot, address member, bytes32 report) returns uint256 {
    require ghostReportRefSlot == refSlot;
    require ghostReportMember == member;
    require ghostReportHash == report;
    return 0;
}

// definition UINT64_MAX() returns uint64 = max_uint64; //= 0xFFFFFFFFFFFFFFFF;
definition UINT256_MAX() returns uint256 = max_uint256; //= 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

definition DEFAULT_ADMIN_ROLE() returns bytes32 = 0x00;
definition MANAGE_MEMBERS_AND_QUORUM_ROLE() returns bytes32 = 0x66a484cf1a3c6ef8dfd59d24824943d2853a29d96f34a01271efc55774452a51; //keccak256("MANAGE_MEMBERS_AND_QUORUM_ROLE");
definition DISABLE_CONSENSUS_ROLE() returns bytes32 = 0x10b016346186602d93fc7a27ace09ba944baf9453611b186d36acd3d3d667dc0; //keccak256("DISABLE_CONSENSUS_ROLE");
definition MANAGE_FRAME_CONFIG_ROLE() returns bytes32 = 0x921f40f434e049d23969cbe68d9cf3ac1013fbe8945da07963af6f3142de6afe; //keccak256("MANAGE_FRAME_CONFIG_ROLE");
definition MANAGE_FAST_LANE_CONFIG_ROLE() returns bytes32 = 0x4af6faa30fabb2c4d8d567d06168f9be8adb583156c1ecb424b4832a7e4d6717; //keccak256("MANAGE_FAST_LANE_CONFIG_ROLE");
definition MANAGE_REPORT_PROCESSOR_ROLE() returns bytes32 = 0xc5219a8d2d0107a57aad00b22081326d173df87bad251126f070df2659770c3e; //keccak256("MANAGE_REPORT_PROCESSOR_ROLE");
definition UNREACHABLE_QUORUM() returns uint256 = max_uint256; // type(uint256).max
definition ZERO_HASH() returns bytes32 = 0; // bytes32(0)


// rule ideas for HashConsensus (without inheritance):
// ------------------------------------------------------------------------------------------
//  external non-view functions: setFrameConfig(), setFastLaneLengthSlots(), addMember(), removeMember(),
//                               setQuorum(), disableConsensus(), setReportProcessor(), submitReport(),
//                               updateInitialEpoch()
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
//      updateInitialEpoch() - DEFAULT_ADMIN_ROLE
//  3. setFrameConfig() updates epochsPerFrame in a way that either keeps the current reference slot
//     the same or increases it by at least the minimum of old and new frame sizes
//  4. setFastLaneLengthSlots() works as expected, setting it to zero disables the fast lane subset
//     verify with getFrameConfig() and check that fastLaneLengthSlots < frameConfig.epochsPerFrame * SLOTS_PER_EPOCH
//  5. addMember() - cannot add an existing member
//  6. addMember() - cannot add an empty address as a member
//  7, addMember() - adding a member does not add/remove any other member
//  8. addMember() - adding a member increases the total members by 1
//  9. removeMember() - cannot remove a member that does not exists - reverts
// 10. removeMember() - removing a member does not add/remove any other member
// 11. removeMember() - removing a member decreases the total members by 1
// 12. setQuorum() - acts as expectedly, verified by getQuorum()
// 13. disableConsensus() - acts as expectedly, verified by getQuorum()
// 14. setReportProcessor() - acts as expectedly, verified by getReportProcessor(), also cannot set an empty address or the previous address
// 15. submitReport() - slot > max_uint64 => revert
// 16. submitReport() - slot != refSlot of current frame => revert
// 17. submitReport() - same member cannot submit two different reports for the same slot
// 18. submitReport() - reportHash == 0 => revert
// 19. submitReport() - consensusVersion != getConsensusVersion() => revert
// 20. submitReport() - verify that the deadline (frame.reportProcessingDeadlineSlot) is explicitly ==  refSlot + FrameSize
// 21. submitReport() - the same oracle should not report the same slot+hash twice (cannot double vote for same report)
// 22. submitReport() - single call to submit report increases only one support for one variant
//                      sum of supports of all variants < total members,
//                      because if Oracle member changes its mind, its previous support is removed
// 23. submitReport() - when new frame starts _reportVariantsLength should reset to 1
// 24. updateInitialEpoch() - updates correctly the initialEpoch as returned by getFrameConfig()
//                          - you cannot update the initialEpoch to be one that already it arrived
// 25. initialEpochSanity rule - once the system is initialized its initialEpoch setting is always sane


//  1. All the external view functions cannot revert under any circumstance,
//     especially getCurrentFrame() as it is used by LegacyOracle and BaseOracle
// Status: Fail
// https://prover.certora.com/output/80942/ed36de90af05459d9eca30a2adbe4212/?anonymousKey=c9c730984b9637f6fc5d7700d5fc9f69dff5b4f6
rule viewFunctionsDoNotRevert(method f)
    filtered { f -> f.isView }
{
    env e; calldataarg args;
    require e.block.timestamp > saneTimeConfig();
    require e.msg.value == 0; // view functions revert is you send eth

    f@withrevert(e,args);
    assert !lastReverted;
}

// focus only on getCurrentFrame() and verify it does not revert
// Status: Timeout! (without the simplification, shown in saneTimeConfig())
// https://vaas-stg.certora.com/output/80942/899cc6d765c7467c9e2af018ccca2ca5/?anonymousKey=ca1152175e66f3e61e7d2bffaded5098c62c3bbe
// Status: Pass (with simplification)
// https://prover.certora.com/output/80942/9b2a516088b94a73a8a955b2da4798fa/?anonymousKey=342b26e422f091488dcbedf415d9c128ae34d935
rule getCurrentFrameDoesNotRevert() {
    env e; calldataarg args;
    require e.block.timestamp > saneTimeConfig();   // time moves forward (saneTimeConfig is for correct initializing)
    require e.msg.value == 0;                       // view functions revert if you send eth

    getCurrentFrame@withrevert(e);
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
//      updateInitialEpoch() - DEFAULT_ADMIN_ROLE
// Status: Pass
// https://prover.certora.com/output/80942/42f639882bbe4b94bf5b0126311013b2/?anonymousKey=8702698b3953d812f76b895bcc3878460864d7a6
rule onlyAllowedRoleCanCallMethod(method f) 
    filtered { f -> !f.isView }
{
    env e; calldataarg args; env e2;

    bool hasRole_MANAGE_FRAME_CONFIG_ROLE       = hasRole(e,MANAGE_FRAME_CONFIG_ROLE(),e.msg.sender);
    bool hasRole_MANAGE_FAST_LANE_CONFIG_ROLE   = hasRole(e,MANAGE_FAST_LANE_CONFIG_ROLE(),e.msg.sender);
    bool hasRole_MANAGE_MEMBERS_AND_QUORUM_ROLE = hasRole(e,MANAGE_MEMBERS_AND_QUORUM_ROLE(),e.msg.sender);
    bool hasRole_DISABLE_CONSENSUS_ROLE         = hasRole(e,DISABLE_CONSENSUS_ROLE(),e.msg.sender);
    bool hasRole_MANAGE_REPORT_PROCESSOR_ROLE   = hasRole(e,MANAGE_REPORT_PROCESSOR_ROLE(),e.msg.sender);
    bool hasRole_DEFAULT_ADMIN_ROLE             = hasRole(e,DEFAULT_ADMIN_ROLE(),e.msg.sender);

    bool isMember = getIsMember(e,e.msg.sender);

    uint256 quorumBefore = getQuorum(e);

    f@withrevert(e,args);
    bool callReverted = lastReverted;

    uint256 quorumAfter = getQuorum(e2);

    assert ((f.selector == setFrameConfig(uint256,uint256).selector) &&
            !hasRole_MANAGE_FRAME_CONFIG_ROLE) => callReverted;
    
    assert ((f.selector == setFastLaneLengthSlots(uint256).selector) &&
            !hasRole_MANAGE_FAST_LANE_CONFIG_ROLE) => callReverted;
    
    assert ((f.selector == addMember(address,uint256).selector) &&
            !hasRole_MANAGE_MEMBERS_AND_QUORUM_ROLE) => callReverted;
    
    assert ((f.selector == removeMember(address,uint256).selector) &&
            !hasRole_MANAGE_MEMBERS_AND_QUORUM_ROLE) => callReverted;

    assert ((f.selector == setQuorum(uint256).selector) &&
            !hasRole_MANAGE_MEMBERS_AND_QUORUM_ROLE &&                          // without permissions, you
            !hasRole_DISABLE_CONSENSUS_ROLE) => (quorumBefore == quorumAfter);  // cannot change the quorum
    
    assert ((f.selector == disableConsensus().selector) && 
            quorumBefore != UNREACHABLE_QUORUM() &&         // this ensures the quorum was not disabled already
            !hasRole_MANAGE_MEMBERS_AND_QUORUM_ROLE &&
            !hasRole_DISABLE_CONSENSUS_ROLE) => callReverted;
    
    assert ((f.selector == setReportProcessor(address).selector) &&
            !hasRole_MANAGE_REPORT_PROCESSOR_ROLE) => callReverted;
    
    assert ((f.selector == submitReport(uint256,bytes32,uint256).selector) &&
            !isMember) => callReverted;

    assert ((f.selector == updateInitialEpoch(uint256).selector) &&
            !hasRole_DEFAULT_ADMIN_ROLE) => callReverted;
}

/* Private case of the above:
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
*/

//  3. setFrameConfig() updates epochsPerFrame in a way that either keeps the current reference slot
//     the same or increases it by at least the minimum of old and new frame sizes
// Status: Timeout (only first two asserts)
// https://prover.certora.com/output/80942/4a45e56dd5e844d09b131889b4b1e304/?anonymousKey=f687e64cc3d822894394894b26e24ef75834d7bb
// Status: Fails (with last assert)
// https://prover.certora.com/output/80942/83a93731b535479e96b453701aed235d/?anonymousKey=cb9b95302e423b38dc1403c4f848a464c0585e3b
rule setFrameConfigCorrectness() {
    env e; env e2;
    require e.block.timestamp > saneTimeConfig();   // time moves forward (saneTimeConfig is for correct initializing)
    require e2.block.timestamp > e.block.timestamp;

    // Get state before
    uint256 refSlot1; uint256 reportProcessingDeadlineSlot1;
    refSlot1, reportProcessingDeadlineSlot1 = getCurrentFrame(e);
    
    uint256 initialEpoch1; uint256 epochsPerFrame1; uint256 fastLaneLengthSlots1;
    initialEpoch1, epochsPerFrame1, fastLaneLengthSlots1 = getFrameConfig(e);

    uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    setFrameConfig(e2, epochsPerFrame, fastLaneLengthSlots);

    // Get state after
    uint256 refSlot2; uint256 reportProcessingDeadlineSlot2;
    refSlot2, reportProcessingDeadlineSlot2 = getCurrentFrame(e2);

    uint256 initialEpoch2; uint256 epochsPerFrame2; uint256 fastLaneLengthSlots2;
    initialEpoch2, epochsPerFrame2, fastLaneLengthSlots2 = getFrameConfig(e2);

    // verify getter returns updated values
    assert epochsPerFrame == epochsPerFrame2;               // only those asserts cause timeout
    assert fastLaneLengthSlots == fastLaneLengthSlots2;     // only those asserts cause timeout

    // verify the comment of the function:
    // keeps the current reference slot the same or
    // increases it by at least the minimum of old and new frame sizes
    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e2);

    assert refSlot2 >= refSlot1;  // fails

    // assert (epochsPerFrame2 >= epochsPerFrame1) =>
    //            ( (refSlot1 == refSlot2) || (refSlot2 >= refSlot1 + epochsPerFrame1 * slotsPerEpoch) );
    
    // assert (epochsPerFrame2 <= epochsPerFrame1) =>
    //            ( (refSlot1 == refSlot2) || (refSlot2 >= refSlot1 + epochsPerFrame2 * slotsPerEpoch) );
}


//  4. setFastLaneLengthSlots() works as expected, setting it to zero disables the fast lane subset
//     verify with getFrameConfig()
// Status: Pass
// https://prover.certora.com/output/80942/133f5763d704400b8bf17e08db8d01d6/?anonymousKey=c467fc94b9572fb48f8790f6c5ba5872f188ea1b
rule setFastLaneLengthSlotsCorrectness() {
    env e; 
    setFastLaneLengthSlots(e,0);

    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e);

    assert fastLaneLengthSlots == 0;  // this assert passes: https://prover.certora.com/output/80942/133f5763d704400b8bf17e08db8d01d6/?anonymousKey=c467fc94b9572fb48f8790f6c5ba5872f188ea1b
}


//  5. addMember() - cannot add an existing member
//  6. addMember() - cannot add an empty address as a member
// Status: Pass
// https://prover.certora.com/output/80942/d9d92700466f42b9b284bb7c0664314e/?anonymousKey=dfbcd43aa6f2a327b2fbe32e2ed4b51a06f52f3e
rule addMemberRevertsCorrectly() {
    env e; env e2;
    address userA; uint256 quorum;
    bool isUserAMember = getIsMember(e,userA);

    addMember@withrevert(e, userA, quorum);                 // call addMember to add user userA
    bool callReverted = lastReverted;

    assert isUserAMember => callReverted;                   // cannot add existing member, rule 5
    assert (userA == 0) => callReverted;                    // cannot add empty address, rule 6
}


//  7, addMember() - adding a member does not add/remove any other member
// Status: Pass
// https://prover.certora.com/output/80942/c6333d3aad5f47a19a3c91bb05f04e72/?anonymousKey=8ee21a783e8c2bf20dec20e40174f309a5958098
rule addMemberADoesNotModifyMemberB() {
    env e; env e2;
    address userA; uint256 quorum; address userB;
    bool isUserAMemberBefore = getIsMember(e,userA);
    bool isUserBMemberBefore = getIsMember(e,userB);

    addMember(e, userA, quorum);                            // call addMember to add user userA

    bool isUserAMemberAfter = getIsMember(e2,userA);
    bool isUserBMemberAfter = getIsMember(e2,userB);

    require userA != userB;                                 // userA and userB are different

    assert isUserBMemberBefore => isUserBMemberAfter;       // adding userA does not remove userB
    assert !isUserBMemberBefore => !isUserBMemberAfter;     // adding userA does not add userB
}


//  8. addMember() - adding a member increases the total members by 1
// Status: Pass
// https://prover.certora.com/output/80942/f7433cb747754da8a635632b6ae01a2d/?anonymousKey=47221c507f526d533d83e2347625027dfb485b9b
rule addMemberCorrectness() {
    env e; env e2;

    uint256 lengthOf_memberAddressesBefore; uint256 lengthOf_memberStatesBefore;
    lengthOf_memberAddressesBefore, lengthOf_memberStatesBefore = getLengthOfArrays(e);  // using helper

    require lengthOf_memberAddressesBefore == lengthOf_memberStatesBefore;  // those arrays represent the same members
    require lengthOf_memberAddressesBefore < max_uint256;                   // safe assumption

    address userA; uint256 quorum;
    bool isUserAMemberBefore = getIsMember(e,userA);

    addMember(e, userA, quorum);                            // call addMember to add user userA

    uint256 lengthOf_memberAddressesAfter; uint256 lengthOf_memberStatesAfter;
    lengthOf_memberAddressesAfter, lengthOf_memberStatesAfter = getLengthOfArrays(e);  // using helper
    bool isUserAMemberAfter = getIsMember(e2,userA);

    assert !isUserAMemberBefore;                            // cannot add userA if he was a member before
    assert isUserAMemberAfter;                              // adding userA correctly

    assert lengthOf_memberAddressesAfter == lengthOf_memberAddressesBefore + 1; // total members increases correctly
    assert lengthOf_memberStatesAfter == lengthOf_memberStatesBefore + 1;       // total members increases correctly
}


//  9. removeMember() - cannot remove a member that does not exists - reverts
// Status: Pass
// https://prover.certora.com/output/80942/81e58babe3e2440bb3831e79a2ec1a52/?anonymousKey=4c882f7a174da428d20939951e7e1855f7b9b46a
rule removeMemberRevertsCorrectly() {
    env e;
    address userA; uint256 quorum;
    bool isUserAMember = getIsMember(e,userA);

    removeMember@withrevert(e, userA, quorum);              // call removeMember to remove user userA
    bool callReverted = lastReverted;

    assert !isUserAMember => callReverted;                  // cannot remove a non-existing member
}


// 10. removeMember() - removing a member does not add/remove any other member
// Status: Pass
// https://prover.certora.com/output/80942/0711dedd9b0847bd9e5ef3741e6f0017/?anonymousKey=28bc4551b778792663a295c140e8b0c60369ae38
rule removeMemberADoesNotModifyMemberB() {
    env e; env e2;
    address userA; uint256 quorum; address userB;
    bool isUserAMemberBefore = getIsMember(e,userA);
    bool isUserBMemberBefore = getIsMember(e,userB);
    uint256 index1bUserABefore = get_memberIndices1b(e,userA);
    uint256 index1bUserBBefore = get_memberIndices1b(e,userB);

    uint256 lengthOf_memberAddressesBefore; uint256 lengthOf_memberStatesBefore;
    lengthOf_memberAddressesBefore, lengthOf_memberStatesBefore = getLengthOfArrays(e);  // using helper

    if (!isUserBMemberBefore) {
        address user = get_memberAddresses(e,lengthOf_memberAddressesBefore - 1);
        require user != userB;      // safe assumption, if userB is not a member that must hold too (verify?)
    }

    require lengthOf_memberAddressesBefore == lengthOf_memberStatesBefore;  // those arrays represent the same members

    removeMember(e, userA, quorum);                         // call removeMember to remove userA

    bool isUserAMemberAfter = getIsMember(e2,userA);
    bool isUserBMemberAfter = getIsMember(e2,userB);
    uint256 index1bUserAAfter = get_memberIndices1b(e,userA);
    uint256 index1bUserBAfter = get_memberIndices1b(e,userB);

    require userA != userB;                                 // userA and userB are different

    assert isUserBMemberBefore => isUserBMemberAfter;       // adding userA does not remove userB
    assert !isUserBMemberBefore => !isUserBMemberAfter;     // adding userA does not add userB
}


// 11. removeMember() - removing a member decreases the total members by 1
// Status: Pass
// https://prover.certora.com/output/80942/3f82ae3e6cd044578656753520da3cec/?anonymousKey=0ed4f43d9f0ea4d0c923e368f8704f635d2559c0
rule removeMemberCorrectness() {
    env e; env e2;

    uint256 lengthOf_memberAddressesBefore; uint256 lengthOf_memberStatesBefore;
    lengthOf_memberAddressesBefore, lengthOf_memberStatesBefore = getLengthOfArrays(e);  // using helper

    require lengthOf_memberAddressesBefore == lengthOf_memberStatesBefore;  // those arrays represent the same members

    address userA; uint256 quorum;
    bool isUserAMemberBefore = getIsMember(e,userA);

    removeMember(e, userA, quorum);                            // call removeMember to remove user userA

    uint256 lengthOf_memberAddressesAfter; uint256 lengthOf_memberStatesAfter;
    lengthOf_memberAddressesAfter, lengthOf_memberStatesAfter = getLengthOfArrays(e);  // using helper
    bool isUserAMemberAfter = getIsMember(e2,userA);

    assert isUserAMemberBefore;                            // cannot remove userA if he was not a member before
    assert !isUserAMemberAfter;                            // removing userA correctly

    assert lengthOf_memberAddressesAfter == lengthOf_memberAddressesBefore - 1; // total members decreases correctly
    assert lengthOf_memberStatesAfter == lengthOf_memberStatesBefore - 1;       // total members decreases correctly
}


// 12. setQuorum() - acts as expectedly, verified by getQuorum()
// Status: Pass
// https://prover.certora.com/output/80942/87e87d0800a54cab8e65afa68a3817c7/?anonymousKey=b6d525a0007a9ffe891f56477378942c27f7bece
rule setQuorumCorrectness() {
    env e; env e2;

    uint256 lengthOf_memberAddresses; uint256 lengthOf_memberStates;
    lengthOf_memberAddresses, lengthOf_memberStates = getLengthOfArrays(e);  // using helper
    require lengthOf_memberAddresses == lengthOf_memberStates;  // those arrays represent the same members

    uint256 quorumBefore = getQuorum(e);
    uint256 quorum;
    setQuorum@withrevert(e,quorum);
    bool callReverted = lastReverted;
    uint256 quorumAfter = getQuorum(e2);

    assert (quorum <= lengthOf_memberAddresses / 2) => callReverted;
    assert (!callReverted)                          => quorumAfter == quorum;
}


// 13. disableConsensus() - acts as expectedly, verified by getQuorum()
// Status: Pass
// https://prover.certora.com/output/80942/5ed38df088824591989c89b3bef2be35/?anonymousKey=1d644889f3568f43a5809c7e6c1d09b9b18f4bd3
rule disableConsensusCorrectness() {
    env e; env e2;
    disableConsensus(e);
    uint256 quorumAfter = getQuorum(e2);
    assert quorumAfter == UNREACHABLE_QUORUM();
}


// 14. setReportProcessor() - acts as expectedly, verified by getReportProcessor(), also cannot set an empty address or the previous address
// Status: Pass
// https://prover.certora.com/output/80942/e93f597cf66240a4ad143839649692a3/?anonymousKey=ef2ca4c22318b6b1c22f86681e2ece751f4abaa6
rule setReportProcessorCorrectness() {
    env e; env e2;
    address reportProcessorBefore = getReportProcessor(e);
    address reportProcessor;
    setReportProcessor@withrevert(e, reportProcessor);
    bool callReverted = lastReverted;
    address reportProcessorAfter = getReportProcessor(e2);

    assert (reportProcessor == reportProcessorBefore) => callReverted;
    assert (reportProcessor == 0) => callReverted;
    assert !callReverted => (reportProcessorAfter == reportProcessor);
}


// 15. submitReport() - slot > max_uint64 => revert
// Status: Pass
// https://prover.certora.com/output/80942/870be390cf09430f8177e17e1f2d685c/?anonymousKey=bd2021b839df527ae29aa419b43d14beb25c87ea
rule cannotSubmitReportWhenSlotIsAboveMaxUint64() {
    env e;
    uint256 slot; bytes32 report; uint256 consensusVersion;
    submitReport@withrevert(e, slot, report, consensusVersion);
    assert slot > max_uint64 => lastReverted;
}


// 16. submitReport() - slot != refSlot of current frame => revert
// Status: Pass
// https://prover.certora.com/output/80942/ec099c0e1f2145ed9c91c9865aa62c78?anonymousKey=51a7cd4d068a5b22043288a52b7a2e2521585669
rule cannotSubmitReportWhenSlotDoesNotMatchCurrentRefSlot() {
    env e;
    uint256 currentRefSlot; uint256 reportProcessingDeadlineSlot;
    currentRefSlot, reportProcessingDeadlineSlot = getCurrentFrame(e);
    
    uint256 slot; bytes32 report; uint256 consensusVersion;
    submitReport@withrevert(e, slot, report, consensusVersion);
    assert slot != currentRefSlot => lastReverted;
}


// 17. submitReport() - same member cannot submit two different reports for the same slot
// Status: Pass
// https://prover.certora.com/output/80942/f74b693ec24c433cae80f54f8623ae78/?anonymousKey=30f5809f7e82a6cd9782fdc9947590d29242be4c
rule sameMemberCannotSubmitDifferentReportForTheSameSlot() {
    env e; env e2;

    uint64 lastReportRefSlot; uint64 lastConsensusRefSlot; uint64 lastConsensusVariantIndex;
    lastReportRefSlot, lastConsensusRefSlot, lastConsensusVariantIndex = helper_getReportingState(e);

    uint256 lastProcessingRefSlot = helper_getLastProcessingRefSlot(e);

    uint256 slot; bytes32 report; uint256 consensusVersion;
    require slot > lastProcessingRefSlot;  // otherwise the report doesn't matter
    require slot > lastConsensusRefSlot;  // reporting for a slot without consensus
    
    submitReport(e, slot, report, consensusVersion);

    bytes32 report2;
    submitReport@withrevert(e2, slot, report2, consensusVersion);

    assert (ghostReportHash != 0) && (e2.msg.sender == e.msg.sender) && (report != report2) => lastReverted;
}


// 18. submitReport() - reportHash == 0 => revert
// Status: Pass
// https://prover.certora.com/output/80942/de955bfeccf045249d7470130ae3338d/?anonymousKey=bec48e627f110948e49b36201dad6c3d72622b0c
rule cannotSubmitReportWithEmptyHash() {
    env e;
    uint256 slot; bytes32 report; uint256 consensusVersion;
    submitReport@withrevert(e, slot, report, consensusVersion);
    bool callReverted = lastReverted;

    assert (report == ZERO_HASH()) => callReverted;
}


// 19. submitReport() - consensusVersion != getConsensusVersion() => revert
// Status: Pass
// https://prover.certora.com/output/80942/3beb82cf292e4db8b39f8a70534cc8fa/?anonymousKey=2665d9fab09defd5f246f302ef5da1e77c058379
rule submitReportMustHaveCorrectConsensusVersion() {
    env e;
    uint256 slot; bytes32 report; uint256 consensusVersion;
    uint correctConsensusVersion = helper_getConsensusVersion(e);
    submitReport@withrevert(e, slot, report, consensusVersion);

    assert (consensusVersion != correctConsensusVersion) => lastReverted;
}


// 20. submitReport() - verify that the deadline (frame.reportProcessingDeadlineSlot) is explicitly ==  refSlot + FrameSize
// Status: Fail
// https://prover.certora.com/output/80942/74b68662860449abb254f6353e66544f/?anonymousKey=9a09cb40908a6e5c4b0d7001623e7a68d94a6bee
rule correctDeadlineCalculation() {
    env e; env e2;
    require e.block.timestamp > saneTimeConfig();
    require e2.block.timestamp >= e.block.timestamp;

    // uint64 lastReportRefSlotA; uint64 lastConsensusRefSlotA; uint64 lastConsensusVariantIndexA;
    // lastReportRefSlotA, lastConsensusRefSlotA, lastConsensusVariantIndexA = helper_getReportingState(e);

    uint256 slot; bytes32 report; uint256 consensusVersion;
    submitReport(e, slot, report, consensusVersion);

    // uint64 lastReportRefSlotB; uint64 lastConsensusRefSlotB; uint64 lastConsensusVariantIndexB;
    // lastReportRefSlotB, lastConsensusRefSlotB, lastConsensusVariantIndexB = helper_getReportingState(e2);

    // require lastReportRefSlotB > lastReportRefSlotA;  // the report was submitted successfully

    uint256 refSlot; uint256 reportProcessingDeadlineSlot;
    refSlot, reportProcessingDeadlineSlot = getCurrentFrame(e2);

    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e2);

    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e2);

    uint256 frameSize = epochsPerFrame * slotsPerEpoch;
    assert (ghostReportHash != 0) => reportProcessingDeadlineSlot == refSlot + frameSize;  // ghostReportHash != 0 ensures report was submitted
}


// 21. submitReport() - the same oracle should not report the same slot+hash twice (cannot double vote for same report)
// Status: Timeout (no saneTimeConfig)
// https://prover.certora.com/output/80942/353d54264ae746bd909eeed800613c53/?anonymousKey=665e5f184d4d34fd75bf1f558c43b6f962f16c77
// Status: - 
// https://prover.certora.com/output/80942/03e046b378e84977983a9e885db3bf07?anonymousKey=16291f5eddc7374fe1faa5754233b8da62dd71e7
rule memberCannotDoubleVote() {
    env e; env e2;
    require e.block.timestamp > saneTimeConfig();
    require e2.block.timestamp >= e.block.timestamp;

    uint256 lastProcessingRefSlot = helper_getLastProcessingRefSlot(e);

    uint256 slot; bytes32 report; uint256 consensusVersion;
    require slot > lastProcessingRefSlot;  // otherwise the report doesn't matter

    submitReport(e, slot, report, consensusVersion);
    submitReport@withrevert(e2, slot, report, consensusVersion);
    assert (ghostReportHash != 0) => lastReverted;  // if the first submitReport() was successful then the second should revert
}


// 22. submitReport() - single call to submit report increases only one support for one variant
//                      sum of supports of all variants < total members,
//                      because if Oracle member changes its mind, its previous support is removed
// Status: -
// 


// 23. submitReport() - when new frame starts _reportVariantsLength should reset to 1
// Status: Pass
// https://prover.certora.com/output/80942/3b158f84570144cbb35652c79bbfef53/?anonymousKey=b31cbd016c673264fae8a91aee8c60bbfef246be
rule variantsResetUponNewFrameStart() {
    env e; env e2;

    uint64 lastReportRefSlot; uint64 lastConsensusRefSlot; uint64 lastConsensusVariantIndex;
    lastReportRefSlot, lastConsensusRefSlot, lastConsensusVariantIndex = helper_getReportingState(e);

    uint256 lastProcessingRefSlot = helper_getLastProcessingRefSlot(e);

    uint256 slot; bytes32 report; uint256 consensusVersion;
    require slot > lastProcessingRefSlot;  // otherwise the report doesn't matter
    require slot > lastConsensusRefSlot;  // reporting for a slot without consensus
    
    submitReport(e, slot, report, consensusVersion);

    uint256 reportVariantsLength = getReportVariantsLength(e2);

    assert ((ghostReportHash != 0) && (lastReportRefSlot != slot)) => reportVariantsLength == 1;
}


// 24. updateInitialEpoch() - updates correctly the initialEpoch as returned by getFrameConfig()
//                          - you cannot update the initialEpoch to be one that already it arrived
// Status: Pass
// https://prover.certora.com/output/80942/3b2b054cad054559b81de132dd676e0d/?anonymousKey=b5142a9cc196ffc7338c450c4ace6b200fc8d12f
rule updateInitialEpochCorrectness() {
    env e1; env e2;

    require e1.block.timestamp < e2.block.timestamp;        // time moves forward only

    // Before update
    uint256 initialEpoch1; uint256 epochsPerFrame1; uint256 fastLaneLengthSlots1;
    initialEpoch1, epochsPerFrame1, fastLaneLengthSlots1 = getFrameConfig(e1);

    uint256 initialEpochUpdate;
    updateInitialEpoch(e2, initialEpochUpdate);

    // After update
    uint256 initialEpoch2; uint256 epochsPerFrame2; uint256 fastLaneLengthSlots2;
    initialEpoch2, epochsPerFrame2, fastLaneLengthSlots2 = getFrameConfig(e2);

    assert initialEpochUpdate == initialEpoch2;  // initialEpoch was updated correctly
    assert (computeEpochAtTimestamp(e2, e2.block.timestamp) < initialEpoch1);  // initialEpoch1 still has not arrived: verifies error InitialEpochAlreadyArrived
}


// 25. initialEpochSanity rule - once the system is initialized its initialEpoch setting is always sane
// Status: Pass
// https://prover.certora.com/output/80942/0dec7449b4c049a4b6cca667f094aa91/?anonymousKey=fd75c248d93e5af85a046ca5b1c42723eea43d60
rule initialEpochSanity(method f) 
    filtered { f -> !f.isView && 
                    f.selector != updateInitialEpoch(uint256).selector } // this should revert once initialized (see rule 26)
{
    env e; calldataarg args; env e2;
    require e.block.timestamp > saneTimeConfig();       // time moves forward (saneTimeConfig is for correct initializing)

    f(e,args);                                          // can call any state changing method

    require e2.block.timestamp >= e.block.timestamp;    // after the call above, verify that the initialEpoch is sane

    uint256 slotsPerEpoch; uint256 secondsPerSlot; uint256 genesisTime;
    slotsPerEpoch, secondsPerSlot, genesisTime = getChainConfig(e2);
    
    uint256 initialEpoch; uint256 epochsPerFrame; uint256 fastLaneLengthSlots;
    initialEpoch, epochsPerFrame, fastLaneLengthSlots = getFrameConfig(e2);

    assert initialEpoch <= ((e2.block.timestamp - genesisTime) / (secondsPerSlot * slotsPerEpoch)); // sane configuration of initialEpoch
}


// 26. updateInitialEpoch should revert once the system is initialized correctly and the initialEpoch passed
// Status: Pass
// https://prover.certora.com/output/80942/5c86836015fc4c9baa0cb035e635975a/?anonymousKey=86dce987e054b75ffa9e119ff360e6a47d607156
rule updateInitialEpochRevertsCorrectly() {
    env e; calldataarg args;
    require e.block.timestamp > saneTimeConfig();       // time moves forward (saneTimeConfig is for correct initializing)

    updateInitialEpoch@withrevert(e,args);

    assert lastReverted;
}



/**************************************************
 *                   MISC Rules                   *
 **************************************************/

// Status: Fails (as expected, no issues)
// https://vaas-stg.certora.com/output/80942/ea773d7513c64b3eb13469903a91dbbc/?anonymousKey=7c4acab781c5df59e5a45ffae8c7d442f3643323
rule sanity(method f) 
    filtered { f -> !f.isView }
{
    env e; calldataarg args;

    f(e,args);
    assert false;
}