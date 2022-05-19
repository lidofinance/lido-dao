const { assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')
const { signDepositData, signPauseData } = require('./helpers/signatures')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

// generateGuardianSignatures

const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const LidoMockForDepositSecurityModule = artifacts.require('LidoMockForDepositSecurityModule.sol')
const NodeOperatorsRegistryMockForSecurityModule = artifacts.require('NodeOperatorsRegistryMockForSecurityModule.sol')
const DepositContractMockForDepositSecurityModule = artifacts.require('DepositContractMockForDepositSecurityModule.sol')

const NETWORK_ID = 1000
const MAX_DEPOSITS_PER_BLOCK = 100
const MIN_DEPOSIT_BLOCK_DISTANCE = 14
const PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS = 10
const GUARDIAN1 = '0x5Fc0E75BF6502009943590492B02A1d08EAc9C43'
const GUARDIAN2 = '0x8516Cbb5ABe73D775bfc0d21Af226e229F7181A3'
const GUARDIAN3 = '0xdaEAd0E0194abd565d28c1013399801d79627c14'
const GUARDIAN_PRIVATE_KEYS = {
  [GUARDIAN1]: '0x3578665169e03e05a26bd5c565ffd12c81a1e0df7d0679f8aee4153110a83c8c',
  [GUARDIAN2]: '0x88868f0fb667cfe50261bb385be8987e0ce62faee934af33c3026cf65f25f09e',
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
  let ATTEST_MESSAGE_PREFIX, PAUSE_MESSAGE_PREFIX
  let block

  before('deploy mock contracts', async () => {
    lidoMock = await LidoMockForDepositSecurityModule.new()
    nodeOperatorsRegistryMock = await NodeOperatorsRegistryMockForSecurityModule.new()
    depositContractMock = await DepositContractMockForDepositSecurityModule.new()
  })

  beforeEach('deploy DepositSecurityModule', async () => {
    block = await web3.eth.getBlock('latest')

    depositSecurityModule = await DepositSecurityModule.new(
      lidoMock.address,
      depositContractMock.address,
      nodeOperatorsRegistryMock.address,
      NETWORK_ID,
      MAX_DEPOSITS_PER_BLOCK,
      MIN_DEPOSIT_BLOCK_DISTANCE,
      PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS,
      { from: owner }
    )

    ATTEST_MESSAGE_PREFIX = await depositSecurityModule.ATTEST_MESSAGE_PREFIX()
    PAUSE_MESSAGE_PREFIX = await depositSecurityModule.PAUSE_MESSAGE_PREFIX()

    for (let i = 0; i < MIN_DEPOSIT_BLOCK_DISTANCE; ++i) {
      await waitBlocks(MIN_DEPOSIT_BLOCK_DISTANCE)
    }
  })

  async function waitBlocks(numBlocksToMine) {
    for (let i = 0; i < numBlocksToMine; ++i) {
      await network.provider.send('evm_mine')
      block = await web3.eth.getBlock('latest')
    }
  }

  describe('depositBufferedEther', () => {
    const KEYS_OP_INDEX = 12
    const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

    beforeEach('init attestMessagePrefix and setup mocks', async () => {
      await nodeOperatorsRegistryMock.setKeysOpIndex(KEYS_OP_INDEX)
      assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), KEYS_OP_INDEX, 'invariant failed: keysOpIndex')

      await depositContractMock.set_deposit_root(DEPOSIT_ROOT)
      assert.equal(await depositContractMock.get_deposit_root(), DEPOSIT_ROOT, 'invariant failed: depositRoot')
    })
    context('total_guardians=0, quorum=0', async () => {
      beforeEach('set total_guardians=0, quorum=0', async () => {
        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 0, 'invariant failed: guardians != 0')

        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 0, 'invariant failed: quorum != 0')
      })
      it('deposits are impossible', async () => {
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, [], {
            from: stranger
          }),
          'no guardian quorum'
        )
      })
    })
    context('total_guardians=1, quorum=1', () => {
      beforeEach('set total_guardians=1, quorum=1', async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 1, { from: owner })

        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 1, 'invariant failed: guardians != 1')

        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 1, 'invariant failed: quorum != 1')
      })
      it("can deposit with the guardian's sig", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
      })
      it('cannot deposit with an unrelated sig', async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
        ]

        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'invalid signature'
        )
      })
      it('cannot deposit with no sigs', async () => {
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, []),
          'no guardian quorum'
        )
      })
      it('cannot deposit if deposit contract root changed', async () => {
        const newDepositRoot = '0x9daddc4daa5915981fd9f1bcc367a2be1389b017d5c24a58d44249a5dbb60289'

        await depositContractMock.set_deposit_root(newDepositRoot)
        assert.equal(await depositContractMock.get_deposit_root(), newDepositRoot, 'invariant failed: depositRoot')

        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'deposit root changed'
        )
      })
      it('cannot deposit if keysOpIndex changed', async () => {
        const newKeysOpIndex = 11
        await nodeOperatorsRegistryMock.setKeysOpIndex(newKeysOpIndex)
        assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), newKeysOpIndex, 'invariant failed: keysOpIndex')

        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'keys op index changed'
        )
      })

      it('cannot deposit more frequently than allowed', async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'too frequent deposits'
        )
      })
      it('cannot deposit when blockHash and blockNumber from different blocks', async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        const staleBlockHash = block.hash
        await waitBlocks(1)
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, staleBlockHash, signatures),
          'unexpected block hash'
        )
      })
      it('cannot deposit with zero block hash', async () => {
        const staleBlock = block
        await waitBlocks(255)
        const signatures = [
          signDepositData(
            ATTEST_MESSAGE_PREFIX,
            DEPOSIT_ROOT,
            KEYS_OP_INDEX,
            staleBlock.number,
            staleBlock.hash,
            GUARDIAN_PRIVATE_KEYS[GUARDIAN1]
          )
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, staleBlock.number, '0x', signatures),
          'unexpected block hash'
        )
      })
    })
    context('total_guardians=3, quorum=2', () => {
      beforeEach('set total_guardians=3, quorum=2', async () => {
        await depositSecurityModule.addGuardians([GUARDIAN3, GUARDIAN1, GUARDIAN2], 2, { from: owner })

        const guardians = await depositSecurityModule.getGuardians()
        assert.equal(guardians.length, 3, 'invariant failed: guardians != 3')

        const quorum = await depositSecurityModule.getGuardianQuorum()
        assert.equal(quorum, 2, 'invariant failed: quorum != 2')
      })
      it("can deposit with guardian's sigs (0,1,2)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])
        ]

        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
      })
      it("can deposit with guardian's sigs (0,1)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
        ]

        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
      })
      it("can deposit with guardian's sigs (0,2)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])
        ]

        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
      })
      it("can deposit with guardian's sigs (1,2)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN3])
        ]
        const tx = await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)
        assertEvent(tx.receipt, 'Deposited', {
          expectedArgs: { maxDeposits: MAX_DEPOSITS_PER_BLOCK },
          decodeForAbi: LidoMockForDepositSecurityModule._json.abi
        })
      })
      it('cannot deposit with no sigs', async () => {
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, []),
          'no guardian quorum'
        )
      })
      it("cannot deposit with guardian's sigs (1,0)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'signatures not sorted'
        )
      })
      it("cannot deposit with guardian's sigs (0,0,1)", async () => {
        const signatures = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures),
          'signatures not sorted'
        )
      })
      it('cannot deposit with partially-unrelated sigs, e.g. (0,U,U)', async () => {
        const signature = [
          signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1]),
          signDepositData(
            ATTEST_MESSAGE_PREFIX,
            DEPOSIT_ROOT,
            KEYS_OP_INDEX,
            block.number,
            block.hash,
            UNRELATED_SIGNER_PRIVATE_KEYS[UNRELATED_SIGNER1]
          ),
          signDepositData(
            ATTEST_MESSAGE_PREFIX,
            DEPOSIT_ROOT,
            KEYS_OP_INDEX,
            block.number,
            block.hash,
            UNRELATED_SIGNER_PRIVATE_KEYS[UNRELATED_SIGNER2]
          )
        ]
        await assertRevert(
          depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signature),
          'invalid signature'
        )
      })
    })
  })
  describe('pauseDeposits, total_guardians=2', () => {
    beforeEach('add guardians and check that not paused', async () => {
      await depositSecurityModule.addGuardian(guardian, 1, { from: owner })
      await depositSecurityModule.addGuardian(GUARDIAN2, 1, { from: owner })
      const guardians = await depositSecurityModule.getGuardians()
      assert.equal(guardians.length, 2, 'invariant failed: guardians != 2')
      assert.equal(await depositSecurityModule.isPaused(), false, 'invariant failed: isPaused')
    })
    it('if called by a guardian 1 or 2', async () => {
      await depositSecurityModule.pauseDeposits(block.number, ['0x', '0x'], { from: guardian })
      assert.equal(await depositSecurityModule.isPaused(), true, 'invalid result: not paused')
    })
    it('pauses if called by an anon submitting sig of guardian 1 or 2', async () => {
      const sig = signPauseData(PAUSE_MESSAGE_PREFIX, block.number, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
      await depositSecurityModule.pauseDeposits(block.number, sig, { from: stranger })
      assert.equal(await depositSecurityModule.isPaused(), true, 'invalid result: not paused')
    })
    it('reverts if called by an anon submitting an unrelated sig', async () => {
      const sig = signPauseData(PAUSE_MESSAGE_PREFIX, block.number, UNRELATED_SIGNER_PRIVATE_KEYS[UNRELATED_SIGNER1])
      await assertRevert(depositSecurityModule.pauseDeposits(block.number, sig), 'invalid signature')
    })
    it('reverts if called by a guardian with an expired blockNumber', async () => {
      const staleBlockNumber = block.number - PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
      await assertRevert(depositSecurityModule.pauseDeposits(staleBlockNumber, ['0x', '0x'], { from: guardian }), 'pause intent expired')
    })
    it("reverts if called by an anon submitting a guardian's sig but with an expired `blockNumber`", async () => {
      const staleBlockNumber = block.number - PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
      const sig = signPauseData(PAUSE_MESSAGE_PREFIX, staleBlockNumber, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
      await assertRevert(depositSecurityModule.pauseDeposits(staleBlockNumber, sig, { from: stranger }), 'pause intent expired')
    })
    it('reverts if called by a guardian with a future blockNumber', async () => {
      const futureBlockNumber = block.number + 100
      await assertRevert(depositSecurityModule.pauseDeposits(futureBlockNumber, ['0x', '0x'], { from: guardian }))
    })
    it("reverts if called by an anon submitting a guardian's sig with a future blockNumber", async () => {
      const futureBlockNumber = block.number + 100
      const sig = signPauseData(PAUSE_MESSAGE_PREFIX, futureBlockNumber, GUARDIAN_PRIVATE_KEYS[GUARDIAN2])
      await assertRevert(depositSecurityModule.pauseDeposits(futureBlockNumber, sig, { from: guardian }))
    })
    it("pauseDeposits emits DepositsPaused(guardianAddr) event if wasn't paused before", async () => {
      assert.isFalse(await depositSecurityModule.isPaused(), 'invariant failed: isPaused != true')
      const tx = await depositSecurityModule.pauseDeposits(block.number, ['0x', '0x'], { from: guardian })
      assertEvent(tx, 'DepositsPaused', { expectedArgs: { guardian: guardian } })
    })
    it("pauseDeposits doesn't emit DepositsPaused(guardianAddr) event if was paused before", async () => {
      await depositSecurityModule.pauseDeposits(block.number, ['0x', '0x'], { from: guardian })
      assert.isTrue(await depositSecurityModule.isPaused(), 'invariant failed: isPaused != true')
      const tx = await depositSecurityModule.pauseDeposits(block.number, ['0x', '0x'], { from: guardian })
      assert.equal(tx.logs.length, 0, 'invalid result: logs not empty')
    })
  })
  describe('unpauseDeposits', () => {
    beforeEach('add guardians and check that not paused', async () => {
      await depositSecurityModule.addGuardian(guardian, 1, { from: owner })
      const guardians = await depositSecurityModule.getGuardians()
      assert.equal(guardians.length, 1, 'invariant failed: guardians != 1')
      assert.equal(await depositSecurityModule.isPaused(), false, 'invariant failed: isPaused')
    })
    it('unpauses paused deposits', async () => {
      await depositSecurityModule.pauseDeposits(block.number, ['0x', '0x'], { from: guardian })
      assert.equal(await depositSecurityModule.isPaused(), true, 'invariant failed: isPaused')
      await depositSecurityModule.unpauseDeposits({ from: owner })
      assert.equal(await depositSecurityModule.isPaused(), false, 'invalid result: isPaused')
    })
    it('cannot be called by non-admin', async () => {
      await assertRevert(depositSecurityModule.unpauseDeposits({ from: stranger }), 'not an owner')
    })
  })
  describe('Guardians', () => {
    context(`guardians checks`, async () => {
      it(`getGuardians returns empty list initially`, async () => {
        assert.equal((await depositSecurityModule.getGuardians()).length, 0)
      })
      it(`addGuardian can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: stranger }), 'not an owner')
      })
      it(`addGuardian adds a guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 1)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
      })
      it(`isGuardian is true for guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
      })
      it(`isGuardian is false for non-guardian`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })
        assert.isFalse(await depositSecurityModule.isGuardian(GUARDIAN2))
      })
      it(`getGuardianIndex works`, async () => {
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)

        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)

        await depositSecurityModule.addGuardian(GUARDIAN2, 0, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), 1)

        await depositSecurityModule.addGuardian(GUARDIAN3, 0, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), 1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), 2)
      })
      it(`addGuardian doesn't add duplicate`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })
        await assertRevert(depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner }), 'duplicate address')
      })
      it(`addGuardians can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1], 0, { from: stranger }), 'not an owner')
      })
      it(`addGuardians adds set of guardians`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], 0, { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 2)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN2))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN2))
      })
      it(`addGuardians doesn't add a set with duplicate`, async () => {
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN1], 0, { from: owner }), 'duplicate address')
        await depositSecurityModule.addGuardians([GUARDIAN1], 0, { from: owner })
        await assertRevert(depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], 0, { from: owner }), 'duplicate address')
      })
      it(`removeGuardian can't be called by non-admin`, async () => {
        await assertRevert(depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: stranger }), 'not an owner')
      })
      it(`removeGuardian reverts on incorrect address`, async () => {
        await assertRevert(depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner }), 'not a guardian')
      })
      it(`removeGuardian removes guardian and sets new quorum`, async () => {
        await depositSecurityModule.addGuardian(GUARDIAN1, 1, { from: owner })
        await depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner })
        assert.equal((await depositSecurityModule.getGuardians()).length, 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)
        assert.equal(await depositSecurityModule.getGuardianQuorum(), 0)
      })
      it(`removeGuardian can be used to remove all guardians going from head`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2, GUARDIAN3], 0, { from: owner })

        await depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [GUARDIAN3, GUARDIAN2])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), 1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), 0)

        await depositSecurityModule.removeGuardian(GUARDIAN3, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [GUARDIAN2])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), -1)

        await depositSecurityModule.removeGuardian(GUARDIAN2, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), -1)
      })
      it(`removeGuardian can be used to remove all guardians going from tail`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2, GUARDIAN3], 0, { from: owner })

        await depositSecurityModule.removeGuardian(GUARDIAN3, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [GUARDIAN1, GUARDIAN2])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), 1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), -1)

        await depositSecurityModule.removeGuardian(GUARDIAN2, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [GUARDIAN1])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), -1)

        await depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner })
        assert.deepEqual(await depositSecurityModule.getGuardians(), [])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), -1)
      })
      it(`removeGuardian can be used to a guardian from the middle`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2, GUARDIAN3], 0, { from: owner })
        await depositSecurityModule.removeGuardian(GUARDIAN2, 0, { from: owner })
        assert.sameMembers(await depositSecurityModule.getGuardians(), [GUARDIAN1, GUARDIAN3])
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN1), 0)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN2), -1)
        assert.equal(await depositSecurityModule.getGuardianIndex(GUARDIAN3), 1)
      })
      it(`removeGuardian updates quorum`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], 2, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianQuorum(), 2)
        await depositSecurityModule.removeGuardian(GUARDIAN1, 1, { from: owner })
        assert.equal(await depositSecurityModule.getGuardianQuorum(), 1)
      })
      it(`addGuardian re-adds deleted guardian`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], 0, { from: owner })
        await depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner })

        await depositSecurityModule.addGuardian(GUARDIAN1, 0, { from: owner })

        assert.equal((await depositSecurityModule.getGuardians()).length, 2)
        assert.isTrue(await depositSecurityModule.isGuardian(GUARDIAN1))
        assert.isTrue((await depositSecurityModule.getGuardians()).includes(GUARDIAN1))
      })
      it(`addGuardians re-adds deleted guardian`, async () => {
        await depositSecurityModule.addGuardians([GUARDIAN1, GUARDIAN2], 0, { from: owner })
        await depositSecurityModule.removeGuardian(GUARDIAN1, 0, { from: owner })

        await depositSecurityModule.addGuardians([GUARDIAN1], 0, { from: owner })

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
    it('set new owner to zero address should reverts', async () => {
      await assertRevert(
        depositSecurityModule.setOwner(ZERO_ADDRESS, { from: owner }),
        'invalid value for owner: must be different from zero address'
      )
    })
    it('set new owner by owner', async () => {
      assertEvent(await depositSecurityModule.setOwner(stranger, { from: owner }), 'OwnerChanged', {
        expectedArgs: { newValue: stranger }
      })
      assert.equal(await depositSecurityModule.getOwner(), stranger, 'owner not changed')
    })
  })
  describe('levers', () => {
    it('setLastDepositBlock', async () => {
      assertRevert(depositSecurityModule.setLastDepositBlock(10, { from: stranger }), `not an owner`)

      await depositSecurityModule.setLastDepositBlock(10, { from: owner })
      assert.equal(await depositSecurityModule.getLastDepositBlock(), 10, 'wrong last deposit block')
    })
    it('setNodeOperatorsRegistry sets new value for nodeOperatorsRegistry if called by owner', async () => {
      const newNodeOperatorsRegistry = await NodeOperatorsRegistryMockForSecurityModule.new()
      assert.notEqual(
        await depositSecurityModule.getNodeOperatorsRegistry(),
        newNodeOperatorsRegistry.address,
        'invariant failed: nodeOperatorsRegistry'
      )
      const tx = await depositSecurityModule.setNodeOperatorsRegistry(newNodeOperatorsRegistry.address, { from: owner })
      assert.equal(
        await depositSecurityModule.getNodeOperatorsRegistry(),
        newNodeOperatorsRegistry.address,
        'invalid result: setNodeOperatorsRegistry'
      )
      assertEvent(tx, 'NodeOperatorsRegistryChanged', {
        expectedArgs: { newValue: newNodeOperatorsRegistry.address }
      })
    })
    it('setNodeOperatorsRegistry reverts if called not by owner', async () => {
      const newNodeOperatorsRegistry = await NodeOperatorsRegistryMockForSecurityModule.new()
      await assertRevert(depositSecurityModule.setNodeOperatorsRegistry(newNodeOperatorsRegistry.address, { from: stranger }))
    })
    it('pauseIntentValidityPeriodBlocks should be gt 0', async () => {
      await assertRevert(
        depositSecurityModule.setPauseIntentValidityPeriodBlocks(0, { from: owner }),
        'invalid value for pauseIntentValidityPeriodBlocks: must be greater then 0'
      )
    })
    it('setPauseIntentValidityPeriodBlocks sets new value for pauseIntentValidityPeriodBlocks if called by owner', async () => {
      const newPauseIntentValidityPeriodBlocks = PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS + 1
      assert.notEqual(
        await depositSecurityModule.getPauseIntentValidityPeriodBlocks(),
        newPauseIntentValidityPeriodBlocks.address,
        'invariant failed: pauseIntentValidityPeriodBlocks'
      )
      const tx = await depositSecurityModule.setPauseIntentValidityPeriodBlocks(newPauseIntentValidityPeriodBlocks, { from: owner })
      assert.equal(
        await depositSecurityModule.getPauseIntentValidityPeriodBlocks(),
        newPauseIntentValidityPeriodBlocks,
        'invalid result: pauseIntentValidityPeriodBlocks'
      )
      assertEvent(tx, 'PauseIntentValidityPeriodBlocksChanged', {
        expectedArgs: { newValue: newPauseIntentValidityPeriodBlocks }
      })
    })
    it('setPauseIntentValidityPeriodBlocks reverts if called not by owner', async () => {
      const newPauseIntentValidityPeriodBlocks = PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS + 1
      await assertRevert(depositSecurityModule.setPauseIntentValidityPeriodBlocks(newPauseIntentValidityPeriodBlocks, { from: stranger }))
    })
    it('setMaxDeposits sets new value maxDepositsPerBlock if called by owner', async () => {
      const newMaxDeposits = MAX_DEPOSITS_PER_BLOCK + 1
      assert.notEqual(await depositSecurityModule.getMaxDeposits(), newMaxDeposits, 'invariant failed: maxDeposits')
      const tx = await depositSecurityModule.setMaxDeposits(newMaxDeposits, { from: owner })
      assert.equal(await depositSecurityModule.getMaxDeposits(), newMaxDeposits, 'invalid result: setMaxDeposits')
      assertEvent(tx, 'MaxDepositsChanged', {
        expectedArgs: { newValue: newMaxDeposits }
      })
    })
    it('setMaxDeposits reverts if called not by owner', async () => {
      const newMaxDeposits = MAX_DEPOSITS_PER_BLOCK + 1
      await assertRevert(depositSecurityModule.setMaxDeposits(newMaxDeposits, { from: stranger }))
    })
    it('minDepositBlockDistance should be gt 0', async () => {
      await assertRevert(
        depositSecurityModule.setMinDepositBlockDistance(0, { from: owner }),
        'invalid value for minDepositBlockDistance: must be greater then 0'
      )
    })
    it('setMinDepositBlockDistance sets new value for minDepositBlockDistance if called by owner', async () => {
      const newMinDepositBlockDistance = MIN_DEPOSIT_BLOCK_DISTANCE + 1
      assert.notEqual(
        await depositSecurityModule.getMinDepositBlockDistance(),
        newMinDepositBlockDistance,
        'invariant failed: minDepositBlockDistance'
      )
      const tx = await depositSecurityModule.setMinDepositBlockDistance(newMinDepositBlockDistance, { from: owner })
      assert.equal(
        await depositSecurityModule.getMinDepositBlockDistance(),
        newMinDepositBlockDistance,
        'invalid result: setMinDepositBlockDistance'
      )
      assertEvent(tx, 'MinDepositBlockDistanceChanged', {
        expectedArgs: { newValue: newMinDepositBlockDistance }
      })
    })
    it('setMinDepositBlockDistance reverts if called not by owner', async () => {
      const newMinDepositBlockDistance = MIN_DEPOSIT_BLOCK_DISTANCE + 1
      await assertRevert(depositSecurityModule.setMinDepositBlockDistance(newMinDepositBlockDistance, { from: stranger }))
    })
  })
  describe('canDeposit', () => {
    it('true if not paused and quorum > 0 and currentBlock - lastDepositBlock >= minDepositBlockDistance', async () => {
      const KEYS_OP_INDEX = 12
      const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

      await depositSecurityModule.addGuardian(GUARDIAN1, 1, { from: owner })

      assert.equal(await depositSecurityModule.isPaused(), false, 'invariant failed: isPaused')
      assert.isTrue((await depositSecurityModule.getGuardianQuorum()) > 0, 'invariant failed: quorum > 0')

      const signatures = [
        signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
      ]
      await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)

      const lastDepositBlockNumber = await web3.eth.getBlockNumber()
      await waitBlocks(2 * MIN_DEPOSIT_BLOCK_DISTANCE)

      const currentBlockNumber = await web3.eth.getBlockNumber()
      const minDepositBlockDistance = await depositSecurityModule.getMinDepositBlockDistance()

      assert.isTrue(currentBlockNumber - lastDepositBlockNumber >= minDepositBlockDistance)
      assert.isTrue(await depositSecurityModule.canDeposit())
    })
    it('false if paused and quorum > 0 and currentBlock - lastDepositBlock >= minDepositBlockDistance', async () => {
      const KEYS_OP_INDEX = 12
      const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

      await depositSecurityModule.addGuardians([GUARDIAN1, guardian], 1, { from: owner })
      assert.isTrue((await depositSecurityModule.getGuardianQuorum()) > 0, 'invariant failed: quorum > 0')

      const signatures = [
        signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
      ]
      await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)

      const lastDepositBlockNumber = await web3.eth.getBlockNumber()
      await waitBlocks(2 * MIN_DEPOSIT_BLOCK_DISTANCE)

      const minDepositBlockDistance = await depositSecurityModule.getMinDepositBlockDistance()

      assert.isTrue(block.number - lastDepositBlockNumber >= minDepositBlockDistance)

      const sig = signPauseData(PAUSE_MESSAGE_PREFIX, block.number, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
      await depositSecurityModule.pauseDeposits(block.number, sig, { from: guardian })
      assert.isTrue(await depositSecurityModule.isPaused(), 'invariant failed: isPaused')
      assert.isFalse(await depositSecurityModule.canDeposit())
    })
    it('false if not paused and quorum == 0 and currentBlock - lastDepositBlock >= minDepositBlockDistance', async () => {
      const KEYS_OP_INDEX = 12
      const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

      await depositSecurityModule.addGuardians([GUARDIAN1, guardian], 1, { from: owner })
      assert.isTrue((await depositSecurityModule.getGuardianQuorum()) > 0, 'invariant failed: quorum > 0')

      const signatures = [
        signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
      ]
      await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)

      const lastDepositBlockNumber = await web3.eth.getBlockNumber()
      await waitBlocks(2 * MIN_DEPOSIT_BLOCK_DISTANCE)

      const currentBlockNumber = await web3.eth.getBlockNumber()
      const minDepositBlockDistance = await depositSecurityModule.getMinDepositBlockDistance()

      assert.isTrue(currentBlockNumber - lastDepositBlockNumber >= minDepositBlockDistance)
      await depositSecurityModule.setGuardianQuorum(0, { from: owner })
      assert.equal(await depositSecurityModule.getGuardianQuorum(), 0, 'invariant failed: quorum == 0')
      assert.isFalse(await depositSecurityModule.canDeposit())
    })
    it('false if not paused and quorum > 0 and currentBlock - lastDepositBlock < minDepositBlockDistance', async () => {
      const KEYS_OP_INDEX = 12
      const DEPOSIT_ROOT = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'

      await depositSecurityModule.addGuardian(GUARDIAN1, 1, { from: owner })

      assert.equal(await depositSecurityModule.isPaused(), false, 'invariant failed: isPaused')
      assert.isTrue((await depositSecurityModule.getGuardianQuorum()) > 0, 'invariant failed: quorum > 0')

      const signatures = [
        signDepositData(ATTEST_MESSAGE_PREFIX, DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, GUARDIAN_PRIVATE_KEYS[GUARDIAN1])
      ]
      await depositSecurityModule.depositBufferedEther(DEPOSIT_ROOT, KEYS_OP_INDEX, block.number, block.hash, signatures)

      const lastDepositBlockNumber = await web3.eth.getBlockNumber()
      await waitBlocks(Math.floor(MIN_DEPOSIT_BLOCK_DISTANCE / 2))

      const currentBlockNumber = await web3.eth.getBlockNumber()
      const minDepositBlockDistance = await depositSecurityModule.getMinDepositBlockDistance()

      assert.isTrue(currentBlockNumber - lastDepositBlockNumber < minDepositBlockDistance)
      assert.isFalse(await depositSecurityModule.canDeposit())
    })
  })
})
