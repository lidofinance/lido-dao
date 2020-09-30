
const UNLIMITED = 1000000000

//setup oracleMembers
await aclHelper.setPermission(oracleMember, MANAGE_MEMBERS, holder1, holders)
await aclHelper.setPermission(oracleMember, SET_ORACLE, holder1, holders)
await aclHelper.setPermission(oracleMember, MANAGE_QUORUM, holder1, holders)
await dePoolOracleHelper.addOracleMember(oracleMember, holder1, holders)
const oracleMembers = await dePoolOracleHelper.getAllOracleMembers()
t.true(oracleMembers.includes(oracleMember), 'Check is oracle member  set')


//create staking provider
await stakingProviderHelper.addStakingProvider("test provider", ADDRESS_2, UNLIMITED)
let sp = await stakingProviderHelper.getStakingProvider(0, true)
t.is(sp.active, true, 'Check that the staking provider is active');
t.is(sp.name, " test provider", 'Check that the staking provider name is correct ');


//Set withdrawal credentials
const withdrawalAddress = getTestWithdrawalAddress()
await dePoolHelper.setWithdrawalCredentials(withdrawalAddress, holder1, holders) //Vote
t.is(await dePoolHelper.getWithdrawalCredentials(), withdrawalAddress, 'Check set withdrawal credentials ')

//add signing keys
const validatorsTestData = getSigningKeys(1, 0)
await stakingProviderHelper.addSigningKeys(0, validatorsTestData,1, holders) //{Vote}
const signingKey = await stakingProviderHelper.getSigningKey(0,0)
t.is(signingKey.key, validatorsTestData.pubKey, 'Check set signing keys')
t.is(await dePoolHelper.getTotalSigningKeyCount(), '1', 'Check total signing keys')
t.is(await dePoolHelper.getUnusedSigningKeyCount(), '1', 'Check unused signing keys')

//send 32 eth to deposit contract
const depositValue = ETH(32)
await dePoolHelper.putEthToDePoolContract(holder6, depositValue)
const tokenHolderBalance = await stEthHelper.getBalance(holder6)
t.is(await dePoolHelper.getBufferedEther(), depositValue, 'Buffered ether in dePool')
t.is(await dePoolHelper.getTotalControlledEther(), depositValue, 'Total controlled ether in dePool')
t.is(tokenHolderBalance, depositValue, 'Check that holder  receive an appropriate amount of stEth tokens')
t.is(await stEthHelper.getTotalSupply(), depositValue, 'Current token total supply')

//do we need validatorRegistration assertion?

//wait for validator started
await waitFor(20000)

// // Verify that the validator is started
t.true(eth2Helper.isValidatorStarted(signingKey.key), 'Validator with added signing keys started')


// waiting for the validator to receive a reward
await waitFor(20000)

t.is(depositValue,eth2Helper.getValidatorBalance(signingKey),'Check that the validator is validating')

//Set oracle members,set permissions,set quorum
await aclHelper.setPermission(oracleMember, MANAGE_MEMBERS, superUser, holders)
await aclHelper.setPermission(oracleMember, SET_ORACLE, superUser, holders)
await aclHelper.setPermission(oracleMember, MANAGE_QUORUM, superUser, holders)
await dePoolOracleHelper.addOracleMember(oracleMember, holder1, holders)
const oracleMembers = await dePoolOracleHelper.getAllOracleMembers()
t.true(oracleMembers.includes(oracleMember))
//quorum is set to oracleMembers lenght

//Push data to eth1
const oracleData =ETH(100)
dePoolOracleHelper.pushData(await dePoolOracleHelper.getCurrentReportInterval(), oracleData, oracleMember)
t.is(await stEthHelper.getBalance(holder6), depositValue+(oracleData-depositValue)*0.9,'Check that user receive an appropriate amount of reward tokens')

//double signing validation...
