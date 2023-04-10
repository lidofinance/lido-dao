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

    require initialEpoch < ((e0.block.timestamp - genesisTime) / (secondsPerSlot * slotsPerEpoch)); // sane configuration of initialEpoch

    return e0.block.timestamp;
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
// 24. updateInitialEpoch() - updates correctly the initialEpoch as returned by getFrameConfig()
//                          - only ACL role can call it
//                          - you cannot call it twice
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


// 24. updateInitialEpoch() - updates correctly the initialEpoch as returned by getFrameConfig()
//                          - only ACL role can call it
//                          - you cannot call it twice
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
                    f.selector != updateInitialEpoch(uint256).selector } // this should revert once initialized
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
// Status: - 
// 
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