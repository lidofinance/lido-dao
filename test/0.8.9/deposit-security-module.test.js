const { assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')
const { generateGuardianSignatures, signDepositData, signPauseData } = require('./helpers/signatures')

const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const LidoMockForDepositSecurityModule = artifacts.require('LidoMockForDepositSecurityModule.sol')
const NodeOperatorsRegistryMockForSecurityModule = artifacts.require('NodeOperatorsRegistryMockForSecurityModule.sol')
const DepositContractMockForDepositSecurityModule = artifacts.require('DepositContractMockForDepositSecurityModule.sol')

const MAX_DEPOSITS_PER_BLOCK = 100
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10
const GUARDIAN1 = '0x8516Cbb5ABe73D775bfc0d21Af226e229F7181A3'
const GUARDIAN2 = '0x5Fc0E75BF6502009943590492B02A1d08EAc9C43'
const GUARDIAN3 = '0xdaEAd0E0194abd565d28c1013399801d79627c14'
const GUARDIAN_PRIVATE_KEYS = {
  [GUARDIAN1]: '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
  [GUARDIAN2]: '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
  [GUARDIAN3]: '0x75e6f508b637327debc90962cd38943ddb9cfc1fc4a8572fc5e3d0984e1261de'
}

const UNRELATED_SIGNER1 = '0xb1e2Dd268D97a41d95f96293b08CD9b08857DA37'
const UNRELATED_SIGNER2 = '0xe53486BBaC0628C9A5B84eFEf28e08FE73679e4d'
const UNRELATED_SIGNER_PRIVATE_KEYS = {
  [UNRELATED_SIGNER1]: '0x543488a7f9249f22c1045352a627382cd60692a1b2054e0a9889277f728d8514',
  [UNRELATED_SIGNER2]: '0xbabec7d3867c72f6c275135b1e1423ca8f565d6e21a1947d056a195b1c3cae27'
}

contract('DepositSecurityModule', ([owner, stranger, guardian]) => {
  let depositSecurityModule, depositContractMock, lidoMock, nodeOperatorsRegistryMock

  before('deploy mock contracts', async () => {
    lidoMock = await LidoMockForDepositSecurityModule.new()
    nodeOperatorsRegistryMock = await NodeOperatorsRegistryMockForSecurityModule.new()
    depositContractMock = await DepositContractMockForDepositSecurityModule.new()
  })

  beforeEach('deploy DepositSecurityModule', async () => {
    depositSecurityModule = await DepositSecurityModule.new(
      lidoMock.address,
      depositContractMock.address,
      nodeOperatorsRegistryMock.address,
      { from: owner }
    )

    await depositSecurityModule.setMaxDeposits(MAX_DEPOSITS_PER_BLOCK, { from: owner })
  })

  describe('depositBufferedEther', () => {
    context('total_guardians=0, quorum=0', async () => {
      beforeEach('set total_guardians=0, quorum=0', async () => {
        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 0, 'invariant failed: guardians != 0')

        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 0, 'invariant failed: quorum != 0')
      })

      it('deposits are impossible', async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        await assertRevert(
          depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, '0x', { from: stranger }),
          'no guardian quorum'
        )
      })
    })
    context('total_guardians=1, quorum=1', () => {
      beforeEach('set total_guardians=1, quorum=1', async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 1, 'invariant failed: guardians != 1')

        await depositSecurityModule.setGuardianQuorum(1, { from: owner })
        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 1, 'invariant failed: quorum != 1')
      })

      it("can deposit with the guardian's sig", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const guardianIndex = 0
        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [guardianIndex, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])]
        ])

        const tx = await depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature)
        assertEvent(tx.receipt, 'Deposited', { expectedArgs: { maxDeposits }, decodeForAbi: LidoMockForDepositSecurityModule._json.abi })
      })

      it('cannot deposit with an unrelated sig', async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const guardianIndex = 0
        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const unrelatedSignature = generateGuardianSignatures([
          [guardianIndex, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])]
        ])

        await assertRevert(
          depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, unrelatedSignature),
          'no guardian quorum'
        )
      })

      it('cannot deposit with no sigs', async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        await assertRevert(depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, '0x'), 'no guardian quorum')
      })
    })

    context('total_guardians=3, quorum=2', () => {
      beforeEach('set total_guardians=3, quorum=2', async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        await depositSecurityModule.addGuardian(GUARDIAN2, { from: owner })
        await depositSecurityModule.addGuardian(GUARDIAN3, { from: owner })
        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 3, 'invariant failed: guardians != 3')

        await depositSecurityModule.setGuardianQuorum(2, { from: owner })
        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 2, 'invariant failed: quorum != 2')
      })

      it("can deposit with guardian's sigs (0,1,2)", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [1, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])],
          [2, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])]
        ])

        const tx = await depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature)
        assertEvent(tx.receipt, 'Deposited', { expectedArgs: { maxDeposits }, decodeForAbi: LidoMockForDepositSecurityModule._json.abi })
      })

      it("can deposit with guardian's sigs (0,1)", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [1, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])]
        ])

        const tx = await depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature)
        assertEvent(tx.receipt, 'Deposited', { expectedArgs: { maxDeposits }, decodeForAbi: LidoMockForDepositSecurityModule._json.abi })
      })

      it("can deposit with guardian's sigs (0,2)", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [2, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])]
        ])

        const tx = await depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature)
        assertEvent(tx.receipt, 'Deposited', { expectedArgs: { maxDeposits }, decodeForAbi: LidoMockForDepositSecurityModule._json.abi })
      })

      it("can deposit with guardian's sigs (1,2)", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [1, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])],
          [2, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])]
        ])

        const tx = await depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature)
        assertEvent(tx.receipt, 'Deposited', { expectedArgs: { maxDeposits }, decodeForAbi: LidoMockForDepositSecurityModule._json.abi })
      })

      it('cannot deposit with no sigs', async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        await assertRevert(depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, '0x'), 'no guardian quorum')
      })

      it("cannot deposit with guardian's sigs (0,0,0)", async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])]
        ])

        await assertRevert(
          depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature),
          'no guardian quorum'
        )
      })
      it('cannot deposit with partially-unrelated sigs, e.g. (0,U,U)', async () => {
        const maxDeposits = 24
        const keysOpIndex = 10
        const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

        await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

        await depositContractMock.set_deposit_root(depositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

        const attestMessagePrefix = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
        const signature = generateGuardianSignatures([
          [0, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])],
          [1, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, UNRELATED_SIGNER_PRIVATE_KEYS[UNRELATED_SIGNER1])],
          [2, signDepositData(attestMessagePrefix, depositRoot, keysOpIndex, UNRELATED_SIGNER_PRIVATE_KEYS[UNRELATED_SIGNER2])]
        ])

        await assertRevert(
          depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, signature),
          'no guardian quorum'
        )
      })
    })
  })
  describe('pauseDeposits, total_guardians=2', () => {
    let pauseMessagePrefix
    before('set pauseMessagePrefix value', async () => {
      pauseMessagePrefix = await depositSecurityModule.PAUSE_MESSAGE_PREFIX()
    })
    beforeEach('add guardians and check that not paused', async () => {
      await depositSecurityModule.addGuardian(guardian, { from: owner })
      await depositSecurityModule.addGuardian(GUARDIAN2, { from: owner })
      const guardians = await depositSecurityModule.getGuardians()
      assert.equal(guardians.length, 2, 'invariant failed: guardians != 2')
      assert.equal(await depositSecurityModule.isPaused(), false, 'invariant failed: isPaused')
      await depositSecurityModule.setPauseIntentValidityPeriodBlocks(PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS, { from: owner })
    })
    it('if called by a guardian 1 or 2', async () => {
      const guardianIndex = 0
      const blockHeight = await web3.eth.getBlockNumber()
      await depositSecurityModule.pauseDeposits(blockHeight, guardianIndex, 0, '0x', '0x', { from: guardian })
      assert.equal(await depositSecurityModule.isPaused(), true, 'invalid result: not paused')
    })

    it('pauses if called by an anon submitting sig of guardian 1 or 2', async () => {
      const guardianIndex = 1
      const blockHeight = await web3.eth.getBlockNumber()
      const { v, r, s } = signPauseData(pauseMessagePrefix, blockHeight, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
      await depositSecurityModule.pauseDeposits(blockHeight, guardianIndex, v, r, s)
      assert.equal(await depositSecurityModule.isPaused(), true, 'invalid result: not paused')
    })
    it('reverts if called by an anon submitting an unrelated sig', async () => {
      const guardianIndex = 1
      const blockHeight = await web3.eth.getBlockNumber()
      const { v, r, s } = signPauseData(pauseMessagePrefix, blockHeight, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])
      await assertRevert(depositSecurityModule.pauseDeposits(blockHeight, guardianIndex, v, r, s), 'invalid signature')
    })
    it('reverts if called by a guardian with an expired blockNumber', async () => {
      const guardianIndex = 0
      const blockHeight = (await web3.eth.getBlockNumber()) - PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
      await assertRevert(
        depositSecurityModule.pauseDeposits(blockHeight, guardianIndex, 0, '0x', '0x', { from: guardian }),
        'pause intent expired'
      )
    })
    it("reverts is called by an anon submitting a guardian's sig but with an expired `blockNumber`", async () => {
      const guardianIndex = 1
      const blockHeight = (await web3.eth.getBlockNumber()) - PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
      const { v, r, s } = signPauseData(pauseMessagePrefix, blockHeight, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
      await assertRevert(
        depositSecurityModule.pauseDeposits(blockHeight, guardianIndex, v, r, s, { from: guardian }),
        'pause intent expired'
      )
    })
  })
  describe('Guardians', () => {
    context(`guardians checks`, async () => {
      it(`getGuardians returns empty list initially`, async () => {
        assert.equal((await depositSecurityModule.getGuardians()).length, 0)
      })
      it(`addGuardian can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.addGuardian(GUARDIAN1, { from: stranger }), 'not an owner')
      })
      it(`addGuardian adds guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 1)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
      })
      it(`isGuardian is true for guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
      })
      it(`isGuardian is false for non-guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        assert.isFalse(await depositSecurityModule.isGuardian(GUARDIAN2))
      })
      it(`addGuardian doesn't add duplicate`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        await assertRevert(depositSecurityModule.addGuardian(GUARDIAN1, { from: owner }), 'duplicate address')
      })
      it(`addGuardians can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1], { from: stranger }), 'not an owner')
      })
      it(`addGuardians adds set of guardians`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 2)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN2))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN2))
      })
      it(`addGuardians doesn't add a set with duplicate`, async () => {
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN1], { from: owner }), 'duplicate address')
        await depositSecurityModule.addGuardians([GUARDIAN1], { from: owner })
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], { from: owner }), 'duplicate address')
      })
      it(`removeGuardian can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.removeGuardian(0, { from: stranger }), 'not an owner')
      })
      it(`removeGuardian reverts on incorrect index`, async () => {
        await assertRevert(depositSecurityModule.removeGuardian(0, { from: owner }), 'invalid index')
      })
      it(`removeGuardian removes guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })
        await depositSecurityModule.removeGuardian(0, { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 0)
      })
      it(`removeGuardian updates quorum if the new guardians count is less than quorum`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], { from: owner })
        await depositSecurityModule.setGuardianQuorum(2, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianQuorum(), 2)
        await depositSecurityModule.removeGuardian(0, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianQuorum(), 1)
      })
      it(`addGuardian re-adds deleted guardian`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], { from: owner })
        await depositSecurityModule.removeGuardian(0, { from: owner })

        await depositSecurityModule.addGuardian(GUARDIAN1, { from: owner })

        assert.equal((await depositSecurityModule.getGuardians()).length, 2)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
      })
      it(`addGuardians re-adds deleted guardian`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], { from: owner })
        await depositSecurityModule.removeGuardian(0, { from: owner })

        await depositSecurityModule.addGuardians([GUARDIAN1], { from: owner })

        assert.equal((await depositSecurityModule.getGuardians()).length, 2)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
      })
      it(`setGuardianQuorum can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.setGuardianQuorum(1, { from: stranger }), 'not an owner')
      })
      it(`setGuardianQuorum sets the quorum`, async () => {
        await depositSecurityModule.setGuardianQuorum(1, { from: owner })

        assert.equal(await depositSecurityModule.getGuardianQuorum(), 1)
      })
      it(`setGuardianQuorum allows to set the value higher than the current guardians count`, async () => {
        await depositSecurityModule.setGuardianQuorum(2, { from: owner })

        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 2)

        const guardians = await depositSecurityModule.getGuardians()

        assert.isTrue(quorum > guardians.length)
      })
    })
  })
  describe('Owner', () => {
    beforeEach('check initial owner', async () => {
      assert.equal(await depositSecurityModule.getOwner(), owner, 'wrong initial owner')
    })
    it('not owner cannot change', async () => {
      await assertRevert(depositSecurityModule.setOwner(stranger, { from: stranger }), 'not an owner')
    })
    it('set new owner by owner', async () => {
      assertEvent(await depositSecurityModule.setOwner(stranger, { from: owner }), 'OwnerChanged', {
        expectedArgs: { newValue: stranger }
      })
      assert.equal(await depositSecurityModule.getOwner(), stranger, 'owner not changed')
    })
  })
})
