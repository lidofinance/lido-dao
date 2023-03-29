const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../helpers/assert')

const { EvmSnapshot } = require('../helpers/blockchain')
const { toBN } = require('../helpers/utils')
const signingKeys = require('../helpers/signing-keys')

const SigningKeysMock = artifacts.require('SigningKeysMock')
const SigningKeys = artifacts.require('SigningKeys')

const UINT64_MAX_BN = toBN('0xffffffffffffffff')

const nodeOpId1 = 1
const nodeOpId2 = 2

contract('SigningKeys', () => {
  let app
  const snapshot = new EvmSnapshot(ethers.provider)

  const firstNodeOperatorId = 0
  const firstNodeOperatorStartIndex = 0
  const firstNodeOperatorKeys = new signingKeys.FakeValidatorKeys(5, { kFill: 'a', sFill: 'b' })
  const firstNodeOperatorLastIndex = firstNodeOperatorKeys.count - 1
  const secondNodeOperatorId = 1
  const secondNodeOperatorStartIndex = 0
  const secondNodeOperatorKeys = new signingKeys.FakeValidatorKeys(7, { kFill: 'c', sFill: 'd' })

  before('deploy base app', async () => {
    // Deploy the app's base contract.
    app = await SigningKeysMock.new([nodeOpId1, nodeOpId2])
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('saveKeysSigs()', () => {
    it('reverts with INVALID_KEYS_COUNT error when start index == UINT64_MAX', async () => {
      const keysCount = 1
      const [publicKeys, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      await assert.reverts(
        app.saveKeysSigs(firstNodeOperatorId, UINT64_MAX_BN, keysCount, publicKeys, signatures),
        'INVALID_KEYS_COUNT'
      )
    })

    it('works correctly when when start index == UINT64_MAX - 1 and keys count == 1', async () => {
      const keysCount = 1
      const startIndex = UINT64_MAX_BN.sub(toBN(1))
      const [publicKeys, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      await app.saveKeysSigs(firstNodeOperatorId, startIndex, keysCount, publicKeys, signatures)

      const { pubkeys: actualPublicKey, signatures: actualSignature } = await app.loadKeysSigs(
        firstNodeOperatorId,
        startIndex,
        1
      )
      const [expectedPublicKey, expectedSignature] = firstNodeOperatorKeys.get(0)
      assert.equal(actualPublicKey, expectedPublicKey)
      assert.equal(actualSignature, expectedSignature)
    })

    it('reverts with INVALID_KEYS_COUNT error when start index == UINT64_MAX', async () => {
      const keysCount = 1
      const [publicKeys, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      await assert.reverts(
        app.saveKeysSigs(firstNodeOperatorId, UINT64_MAX_BN, keysCount, publicKeys, signatures),
        'INVALID_KEYS_COUNT'
      )
    })

    it('reverts with INVALID_KEYS_COUNT error when keys count > UINT64_MAX', async () => {
      const keysCount = toBN('0x10000000000000001')
      await assert.reverts(
        app.saveKeysSigs(firstNodeOperatorId, firstNodeOperatorStartIndex, keysCount, '0x', '0x'),
        'INVALID_KEYS_COUNT'
      )
    })

    it('reverts with "INVALID_KEYS_COUNT" error when keys count is 0', async () => {
      const keysCount = 0
      await assert.reverts(
        app.saveKeysSigs(firstNodeOperatorId, firstNodeOperatorStartIndex, keysCount, '0x', '0x'),
        'INVALID_KEYS_COUNT'
      )
    })

    it('reverts with "LENGTH_MISMATCH" error when public keys batch has invalid length', async () => {
      const keysCount = 2
      const [publicKeys, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      await assert.reverts(
        app.saveKeysSigs(
          firstNodeOperatorId,
          firstNodeOperatorStartIndex,
          keysCount,
          publicKeys + 'deadbeaf',
          signatures
        ),
        'LENGTH_MISMATCH'
      )
    })

    it('reverts with "LENGTH_MISMATCH" error when signatures batch has invalid length', async () => {
      const keysCount = 2
      const [publicKeys, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      await assert.reverts(
        app.saveKeysSigs(
          firstNodeOperatorId,
          firstNodeOperatorStartIndex,
          keysCount,
          publicKeys,
          signatures.slice(0, -2)
        ),
        'LENGTH_MISMATCH'
      )
    })

    it('reverts with "LENGTH_MISMATCH" error when public keys and signatures length mismatch', async () => {
      const keysCount = 2
      const [publicKeys] = firstNodeOperatorKeys.slice(0, keysCount)
      const [, signatures] = firstNodeOperatorKeys.slice(0, keysCount + 1)
      await assert.reverts(
        app.saveKeysSigs(
          firstNodeOperatorId,
          firstNodeOperatorStartIndex,
          keysCount,
          publicKeys,
          signatures.slice(0, -2)
        ),
        'LENGTH_MISMATCH'
      )
    })

    it('reverts with "EMPTY_KEY" error when public key is zero bytes batch (at 1st position)', async () => {
      const keysCount = 1
      const [, signature] = firstNodeOperatorKeys.get(0)
      await assert.reverts(
        app.saveKeysSigs(
          firstNodeOperatorId,
          firstNodeOperatorStartIndex,
          keysCount,
          signingKeys.EMPTY_PUBLIC_KEY,
          signature
        ),
        'EMPTY_KEY'
      )
    })

    it('reverts with "EMPTY_KEY" error when public key is zero bytes batch (at last position)', async () => {
      const keysCount = 3
      let [publicKeys] = firstNodeOperatorKeys.slice(0, keysCount - 1)
      const [, signatures] = firstNodeOperatorKeys.slice(0, keysCount)
      publicKeys += signingKeys.EMPTY_PUBLIC_KEY.substring(2)
      await assert.reverts(
        app.saveKeysSigs(firstNodeOperatorId, firstNodeOperatorStartIndex, keysCount, publicKeys, signatures),
        'EMPTY_KEY'
      )
    })

    it('emits SigningKeyAdded with correct params for every added key', async () => {
      const receipt = await app.saveKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        ...firstNodeOperatorKeys.slice()
      )
      for (let i = 0; i < firstNodeOperatorKeys.count; ++i) {
        assert.emits(
          receipt,
          'SigningKeyAdded',
          { nodeOperatorId: firstNodeOperatorId, pubkey: firstNodeOperatorKeys.get(i)[0] },
          { abi: SigningKeys._json.abi }
        )
      }
    })

    it('stores keys correctly', async () => {
      await app.saveKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        ...firstNodeOperatorKeys.slice()
      )

      await app.saveKeysSigs(
        secondNodeOperatorId,
        secondNodeOperatorStartIndex,
        secondNodeOperatorKeys.count,
        ...secondNodeOperatorKeys.slice()
      )

      for (let i = 0; i < firstNodeOperatorKeys.count; ++i) {
        const { pubkeys, signatures } = await app.loadKeysSigs(firstNodeOperatorId, i, 1)
        const [expectedPublicKey, expectedSignature] = firstNodeOperatorKeys.get(i)
        assert.equal(pubkeys, expectedPublicKey)
        assert.equal(signatures, expectedSignature)
      }
      for (let i = 0; i < secondNodeOperatorKeys.count; ++i) {
        const { pubkeys, signatures } = await app.loadKeysSigs(secondNodeOperatorId, i, 1)
        const [expectedPublicKey, expectedSignature] = secondNodeOperatorKeys.get(i)
        assert.equal(pubkeys, expectedPublicKey)
        assert.equal(signatures, expectedSignature)
      }
    })

    it('read keys batch correctly', async () => {
      await app.saveKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        ...firstNodeOperatorKeys.slice()
      )

      await app.saveKeysSigs(
        secondNodeOperatorId,
        secondNodeOperatorStartIndex,
        secondNodeOperatorKeys.count,
        ...secondNodeOperatorKeys.slice()
      )

      const { pubkeys, signatures } = await app.loadKeysSigsBatch(
        [secondNodeOperatorId, firstNodeOperatorId],
        [secondNodeOperatorStartIndex + 2, firstNodeOperatorStartIndex + 1],
        [secondNodeOperatorKeys.count - 4, firstNodeOperatorKeys.count - 2]
      )

      let expectedPublicKeys = ''
      let expectedSignatures = ''
      let startIndex = secondNodeOperatorStartIndex + 2
      let endIndex = startIndex + secondNodeOperatorKeys.count - 4
      for (let i = startIndex; i < endIndex; ++i) {
        const [key, sig] = secondNodeOperatorKeys.get(i)
        expectedPublicKeys += key.substring(2)
        expectedSignatures += sig.substring(2)
      }

      startIndex = firstNodeOperatorStartIndex + 1
      endIndex = startIndex + firstNodeOperatorKeys.count - 2
      for (let i = startIndex; i < endIndex; ++i) {
        const [key, sig] = firstNodeOperatorKeys.get(i)
        expectedPublicKeys += key.substring(2)
        expectedSignatures += sig.substring(2)
      }

      assert.equal(pubkeys, '0x' + expectedPublicKeys)
      assert.equal(signatures, '0x' + expectedSignatures)
    })
  })

  describe('removeKeysSigs()', async () => {
    beforeEach(async () => {
      await app.saveKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        ...firstNodeOperatorKeys.slice()
      )
      await app.saveKeysSigs(
        secondNodeOperatorId,
        secondNodeOperatorStartIndex,
        secondNodeOperatorKeys.count,
        ...secondNodeOperatorKeys.slice()
      )
    })

    it('reverts with INVALID_KEYS_COUNT error when keys count is zero ', async () => {
      const keysCount = 0
      await assert.reverts(
        app.removeKeysSigs(firstNodeOperatorId, firstNodeOperatorStartIndex, keysCount, firstNodeOperatorLastIndex),
        'INVALID_KEYS_COUNT'
      )
    })

    it('reverts with INVALID_KEYS_COUNT error when index is greater than last keys index', async () => {
      const keyIndex = firstNodeOperatorLastIndex + 1
      const keysCount = 1
      await assert.reverts(
        app.removeKeysSigs(firstNodeOperatorId, keyIndex, keysCount, firstNodeOperatorLastIndex),
        'INVALID_KEYS_COUNT'
      )
    })

    it('reverts with INVALID_KEYS_COUNT error when keys count is greater than last keys index', async () => {
      const keysCount = firstNodeOperatorKeys.count + 1
      await assert.reverts(
        app.removeKeysSigs(firstNodeOperatorId, firstNodeOperatorStartIndex, keysCount, firstNodeOperatorLastIndex),
        'INVALID_KEYS_COUNT'
      )
    })

    it('emits SigningKeyAdded with correct params for every added key', async () => {
      const receipt = await app.removeKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        firstNodeOperatorKeys.count
      )

      for (let i = firstNodeOperatorStartIndex; i < firstNodeOperatorKeys.count; ++i) {
        assert.emits(
          receipt,
          'SigningKeyRemoved',
          { nodeOperatorId: firstNodeOperatorId, pubkey: firstNodeOperatorKeys.get(i)[0] },
          { abi: SigningKeys._json.abi }
        )
      }
    })

    it('removes keys correctly (clear storage)', async () => {
      await app.removeKeysSigs(
        firstNodeOperatorId,
        firstNodeOperatorStartIndex,
        firstNodeOperatorKeys.count,
        firstNodeOperatorKeys.count
      )

      for (let i = firstNodeOperatorStartIndex; i < firstNodeOperatorKeys.count; ++i) {
        const { pubkeys, signatures } = await app.loadKeysSigs(firstNodeOperatorId, i, 1)
        assert.equal(pubkeys, signingKeys.EMPTY_PUBLIC_KEY)
        assert.equal(signatures, signingKeys.EMPTY_SIGNATURE)
      }
    })

    it('removes keys correctly (move last to deleted position)', async () => {
      const keyIndex = 0
      await app.removeKeysSigs(firstNodeOperatorId, keyIndex, 1, firstNodeOperatorKeys.count)
      const { pubkeys, signatures } = await app.loadKeysSigs(firstNodeOperatorId, keyIndex, 1)
      const [expectedPublicKey, expectedSignature] = firstNodeOperatorKeys.get(firstNodeOperatorLastIndex)
      assert.equal(pubkeys, expectedPublicKey)
      assert.equal(signatures, expectedSignature)
    })
  })
})
