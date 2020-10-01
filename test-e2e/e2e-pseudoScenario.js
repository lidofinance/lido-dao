
const UNLIMITED = 1000000000

//dao is deployed with initial distribuiton of tokens
// (some tokens are vested)
// TODO token.test.js


// deposit contract is deployed
// TODO test from deposit.test.js

// check dao apps
// TODO test from dao.test.js

//dao apps are deployed
t.is(await dePoolHelper.getWithdrawalCredentials(),null, "Check dePool deploy")
t.is(await stEthHelper.getTotalSupply,"0", "Check stEth deploy")
t.is(await stakingProviderHelper.getStakingProvidersCount(),"0","Check stakingProviders deploy")
t.is(await dePoolOracleHelper.getAllOracleMembers(),"0", "Check dePoolOracle deploy")
t.is(await votingHelper.isForwarder(),true, "Check voting deploy")
t.is(await vaultHelper.balance(Address),"100000","Check vault deploy")
t.is(await tokenManagerHelper.isForwarder(),true, "Check tokenManager deploy")
t.is(await acl.hasPermissions(tokenHolder,tokenManagerAddress,MANAGE_WITHDRAWAL_KEY),"Check acl deploy")

//TODO check holders permissions([owner-holder, holder2, holder3, holder4, holder5, holder6])
// there are deployed by default


//set oracle permissions
const [oracleMember1, oracleMember2, oracleMember3, oracleMember4, oracleMember5] = oracleMemebrs
const oraclePermissions = [MANAGE_MEMBERS,MANAGE_QUORUM]
await aclHelper.setPermissions(oracleMemebrs, oraclePermissions, superUser, holders)//{Vote}


//check set permissions for oracle members
t.true(aclHelper.hasPermission(oracleMember1,dePoolOracleAddress,oraclePermissions), "Check permissions for oracle members")


// Add oracle members
await dePoolOracleHelper.addOracleMembers(oracleMemebrs, superUser, holders) //{Vote}
const addedOracleMembers = await dePoolOracleHelper.getAllOracleMembers()
t.true(addedOracleMembers===(oracleMemebrs), "Check is oracle members are  set")


//Set withdrawal credentials
const withdrawalAddress = getDkgWithdrawalAddress()
await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, superUser, holders) //{Vote}
t.is(await dePoolHelper.getWithdrawalCredentials(), withdrawalAddress, "Check set withdrawal credentials")

//create staking providers and add signing keys
const [spsAddress1, spsAddress2, spsAddress3, spsAddress4] = spsAccs
await stakingProviderHelper.addStakingProvider("test provider1", spsAddress1, 2)
const validatorsTestDataForSp1 = getSigningKeys(2, 0)
await stakingProviderHelper.addSigningKeys(0, 2,validatorsTestDataForSp1, holders) //{Vote}

await stakingProviderHelper.addStakingProvider("test provide2", spsAddress2, 5)
const validatorsTestDataForSp2 = getSigningKeys(5, 2)
await stakingProviderHelper.addSigningKeys(1, 100,validatorsTestDataForSp2, holders) //{Vote}

await stakingProviderHelper.addStakingProvider("test provider3", spsAddress3, UNLIMITED)
const validatorsTestDataForSp3 = getSigningKeys(100, 7)
await stakingProviderHelper.addSigningKeys(2, 100,validatorsTestDataForSp3, holders) //{Vote}



//check sp1
const sp1 = await stakingProviderHelper.getStakingProvider(0, true)
t.is(sp1.active, true, "Check that the sp1 is active")
t.is(sp1.name, "test provider1", "Check that the sp1 name is correct")
t.is(sp1.rewardAddress, spsAddress1, "Check that the sp1 is correct")
t.is(sp1.stakingLimit, 2, "Check that the sp1 stakingLimit is correct")
t.is(sp1.totalSigningKeys, 2);
t.is(sp1.usedSigningKeys, 0);
const sp1SigningKeys = await stakingProviderHelper.getSigningKey(0,0)
t.is(sp1SigningKeys.key, validatorsTestDataForSp1.pubKey, "Check that sp1 signing keys set correct") //TODO add wrapper to check all signing keys,not 1

//Check sp2
const sp2 = await stakingProviderHelper.getStakingProvider(1, true)
t.is(sp2.active, true, "Check that the sp2 is active")
t.is(sp2.name, "test provider2", "Check that the sp2 name is correct")
t.is(sp2.rewardAddress, spsAddress2, "Check that the sp2 is correct ")
t.is(sp2.stakingLimit, 5, "Check that the sp2 stakingLimit is correct")
t.is(sp2.totalSigningKeys, 5);
t.is(sp2.usedSigningKeys, 0);
const sp2SigningKeys = await stakingProviderHelper.getSigningKey(1,0)
t.is(sp2SigningKeys.key, validatorsTestDataForSp2.pubKey, "Check that sp1 signing keys set correct") //TODO add wrapper to check all signing keys,not 1

//check sp3
const sp3 = await stakingProviderHelper.getStakingProvider(2, true)
t.is(sp3.active, true, "Check that the sp3 is active")
t.is(sp3.name, "test provider3", "Check that the sp3 name is correct")
t.is(sp3.rewardAddress, spsAddress3, "Check that the sp3 is correct ")
t.is(sp3.stakingLimit, UNLIMITED, "Check that the sp3 stakingLimit is correct")
t.is(sp3.totalSigningKeys, 100);
t.is(sp3.usedSigningKeys, 0);
const sp3SigningKeys = await stakingProviderHelper.getSigningKey(2,0)
t.is(sp3SigningKeys.key, validatorsTestDataForSp3.pubKey, "Check that sp3 signing keys set correct") //TODO add wrapper to check all signing keys,not 1


//send eth to deposit contract
const depositValue1 = ETH(32)
const depositValue2 = ETH(224)
const depositValue3 = ETH(288)
await dePoolHelper.putEthToDePoolContract(eth1User, depositValue1)
await dePoolHelper.putEthToDePoolContract(eth2User, depositValue2)
await dePoolHelper.putEthToDePoolContract(eth3User, depositValue3)

t.is(await dePoolHelper.getBufferedEther(), depositValue1+depositValue2+depositValue3, "Buffered ether in dePool")
t.is(await dePoolHelper.getTotalControlledEther(), depositValue1+depositValue2+depositValue3, "Total controlled ether in dePool")
t.is(await stEthHelper.getBalance(eth1User), depositValue1, "Check that user1  receive an appropriate amount of stEth tokens")
t.is(await stEthHelper.getBalance(eth2User), depositValue2, "Check that user2  receive an appropriate amount of stEth tokens")
t.is(await stEthHelper.getBalance(eth3User), depositValue3, "Check that user3  receive an appropriate amount of stEth tokens")
t.is(await stEthHelper.getTotalSupply(), depositValue1+depositValue2+depositValue3, "Current token total supply")

//TODO Convert some default token to ctoken

//TODO deploy initial validators on a minimal configuration
// deploy oracle daemons

//wait for validator started
await waitFor(20000)

// Verify that the validator is started

let spsUsedSigningKeys = // concat sps used signing keys to array(get it from contract or  concat manually from testData)
t.true(eth2Helper.isValidatorStarted(spsUsedSigningKeys), "Validators with added signing keys started")

//Verify that the sps signing keys became using
t.is(sp1.usedSigningKeys, 2,"sps1 signing keys became using")
t.is(sp1.usedSigningKeys, 5, "sps2 signing keys became using")
t.is(sp1.usedSigningKeys, 10,"sps3 signing keys became using")

// TODO Verify the network is producing and finalizing blocks

// waiting for the validator to receive a reward
await waitFor(20000)

//Push data to eth1
const oracleData =ETH(100)
dePoolOracleHelper.pushData(await dePoolOracleHelper.getCurrentReportInterval(), oracleData, oracleMemebrs)//{Vote}

// Check that users receive an appropriate amount of default tokens by validators rewards
t.is(await stEthHelper.getBalance(eth1User), (((depositValue1 * 100) /stEthHelper.getTotalSupply()) * oracleData) / 100*0.9,"Check that user1 receive an appropriate amount of reward tokens")
t.is(await stEthHelper.getBalance(eth2User), (((depositValue2 * 100) /stEthHelper.getTotalSupply()) * oracleData) / 100*0.9,"Check that user2 receive an appropriate amount of reward tokens")
t.is(await stEthHelper.getBalance(eth3User), (((depositValue3 * 100) /stEthHelper.getTotalSupply()) * oracleData) / 100*0.9,"Check that user3 receive an appropriate amount of reward tokens")

//TODO Broad strokes:
// Report profit,
// ctoken stay the same but is convertable to a right amount of atoken,
// and fees are paid in right amount to the right validators

//TODO Check  that treasury balance increase due to commission
t.is(await getBalance(dePoolHelper.getTreasury()), oracleData*0.1, "Check that treasury balance increase due to commission")




//TODO Report slashing, check that there is no reward and atoken balance decreases and ctoken stay the same

//TODO Manipulate staking providers and check that it has right
// results: add a new staking provider, deactivate one, reduce the staking limit for an SP, increase it
await stakingProviderHelper.addStakingProvider("test provider4", spsAddress4, UNLIMITED)
const validatorsTestDataForSp4 = getSigningKeys(100, 107)
await stakingProviderHelper.addSigningKeys(3, 100,validatorsTestDataForSp4, holders) //{Vote}
t.is(stakingProviderHelper.getActiveStakingProvidersCount(), 4, "Check that the sp4 added to list of active sps")

// Add new provider
const sp4 = await stakingProviderHelper.getStakingProvider(1, true)
t.is(sp4.active, true, "Check that the sp4 is active")
t.is(sp4.name, "test provider2", "Check that the sp4 name is correct")
t.is(sp4.rewardAddress, spsAddress4, "Check that the sp4 is correct ")
t.is(sp4.stakingLimit, UNLIMITED, "Check that the sp4 stakingLimit is correct")
t.is(sp4.totalSigningKeys, 100);
t.is(sp4.usedSigningKeys, 0);
t.is(stakingProviderHelper.getStakingProvidersCount(), "Check that the sp4 is added to list of sps")
t.is(stakingProviderHelper.getActiveStakingProvidersCount(), 4, "Check that the count of active providers is changed")

// deactivate provider
await stakingProviderHelper.setStakingProviderActive(4,false,"Check that the sp4 can be deactivated")
t.is(sp4.active,false,"Check that the sp4 became deactivated" )
t.is(stakingProviderHelper.getActiveStakingProvidersCount(), 3, "Check that the count of active providers is changed after deactivate one")

//TODO deactivate provider with currently using signing keys and check it

//reduce the staking limit for an SP
let oldsp4StakingLimit = sp4.stakingLimit() //UNLIMITED
let newSp4StakingLimit = 200
await stakingProviderHelper.setStakingProviderStakingLimit(3,newSp4StakingLimit)
t.is(oldsp4StakingLimit-newSp4StakingLimit, 999999800, "Check that the sp4 staking limit decrease correctly" )

//increase the staking limit for an SP
oldsp4StakingLimit = sp4.stakingLimit() //200
newSp4StakingLimit = 400
await stakingProviderHelper.setStakingProviderStakingLimit(3,200)
t.is(newSp4StakingLimit - oldsp4StakingLimit, 200, 200, "Check that the sp4 staking limit increase correctly" )

//TODO Test insurance (pending for the actual insurance)
