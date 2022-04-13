/* eslint no-unmodified-loop-condition: "warn" */

const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const CompositePostRebaseBeaconReceiver = artifacts.require('CompositePostRebaseBeaconReceiver.sol')
const BeaconReceiverMock = artifacts.require('BeaconReceiverMock')
const BeaconReceiverMockWithoutERC165 = artifacts.require('BeaconReceiverMockWithoutERC165')

const deployedCallbackCount = 8

contract('CompositePostRebaseBeaconReceiver', ([deployer, voting, oracle, anotherAccount, ...otherAccounts]) => {
  let compositeReceiver
  let callbackMocks

  beforeEach('deploy composite receiver and callback mocks array', async () => {
    compositeReceiver = await CompositePostRebaseBeaconReceiver.new(voting, oracle, { from: deployer })

    callbackMocks = []
    for (let id = 0; id < deployedCallbackCount; id++) {
      const callback = await BeaconReceiverMock.new(id, { from: deployer })
      callbackMocks.push(callback.address)
    }
  })

  describe('add/remove calls', async () => {
    it(`can't use zero addresses`, async () => {
      assertRevert(CompositePostRebaseBeaconReceiver.new(ZERO_ADDRESS, oracle, { from: deployer }), `VOTING_ZERO_ADDRESS`)

      assertRevert(CompositePostRebaseBeaconReceiver.new(voting, ZERO_ADDRESS, { from: deployer }), `ORACLE_ZERO_ADDRESS`)

      assertRevert(compositeReceiver.addCallback(ZERO_ADDRESS, { from: voting }), `CALLBACK_ZERO_ADDRESS`)
    })

    it(`add a single callback works`, async () => {
      const invalidCallback = await BeaconReceiverMockWithoutERC165.new()
      assertRevert(compositeReceiver.addCallback(invalidCallback.address, { from: voting }), `BAD_CALLBACK_INTERFACE`)

      const receipt = await compositeReceiver.addCallback(callbackMocks[0], { from: voting })

      assertBn(await compositeReceiver.callbacksLength(), bn(1))
      assertBn(await compositeReceiver.callbacks(bn(0)), callbackMocks[0])

      assertEvent(receipt, 'CallbackAdded', { expectedArgs: { callback: callbackMocks[0], atIndex: bn(0) } })

      assertAmountOfEvents(receipt, 'CallbackAdded', { expectedAmount: 1 })
    })

    it(`remove a callback from empty compositeReceiver fails`, async () => {
      assertRevert(compositeReceiver.removeCallback(bn(0), { from: voting }), `INDEX_IS_OUT_OF_RANGE`)
    })

    it(`single add/remove calls pair works`, async () => {
      assertBn(await compositeReceiver.callbacksLength(), bn(0))

      const addReceipt = await compositeReceiver.addCallback(callbackMocks[0], { from: voting })
      assertEvent(addReceipt, 'CallbackAdded', { expectedArgs: { callback: callbackMocks[0], atIndex: bn(0) } })
      assertAmountOfEvents(addReceipt, 'CallbackAdded', { expectedAmount: 1 })

      assertBn(await compositeReceiver.callbacksLength(), bn(1))
      assertBn(await compositeReceiver.callbacks(bn(0)), callbackMocks[0])

      const removeReceipt = await compositeReceiver.removeCallback(bn(0), { from: voting })
      assertEvent(removeReceipt, 'CallbackRemoved', { expectedArgs: { callback: callbackMocks[0], atIndex: bn(0) } })
      assertAmountOfEvents(removeReceipt, 'CallbackRemoved', { expectedAmount: 1 })

      assertBn(await compositeReceiver.callbacksLength(), bn(0))
    })

    it(`batch callback add calls work`, async () => {
      for (let id = 0; id < deployedCallbackCount; id++) {
        const nextCallback = callbackMocks[id]
        const addReceipt = await compositeReceiver.addCallback(nextCallback, { from: voting })

        assertEvent(addReceipt, 'CallbackAdded', { expectedArgs: { callback: nextCallback, atIndex: bn(id) } })
        assertAmountOfEvents(addReceipt, 'CallbackAdded', { expectedAmount: 1 })

        assertBn(await compositeReceiver.callbacksLength(), bn(id + 1))
        assertBn(await compositeReceiver.callbacks(bn(id)), nextCallback)
      }
    })

    it(`batch callback add and remove from the front calls work`, async () => {
      for (let id = 0; id < deployedCallbackCount; id++) {
        await compositeReceiver.addCallback(callbackMocks[id], { from: voting })
      }

      for (let id = 0; id < deployedCallbackCount; id++) {
        const nextCallback = callbackMocks[id]
        const removeReceipt = await compositeReceiver.removeCallback(bn(0), { from: voting })

        assertEvent(removeReceipt, 'CallbackRemoved', { expectedArgs: { callback: nextCallback, atIndex: bn(0) } })
        assertAmountOfEvents(removeReceipt, 'CallbackRemoved', { expectedAmount: 1 })

        const newLen = deployedCallbackCount - id - 1
        assertBn(await compositeReceiver.callbacksLength(), bn(newLen))

        for (let j = 0; j < newLen; j++) {
          assertBn(await compositeReceiver.callbacks(bn(j)), callbackMocks[id + j + 1])
        }
      }
    })

    it(`batch callback add and remove from the back calls work`, async () => {
      for (let id = 0; id < deployedCallbackCount; id++) {
        await compositeReceiver.addCallback(callbackMocks[id], { from: voting })
      }

      for (let id = 0; id < deployedCallbackCount; id++) {
        const removePos = deployedCallbackCount - id - 1

        const nextCallback = callbackMocks[removePos]
        const removeReceipt = await compositeReceiver.removeCallback(removePos, { from: voting })

        assertEvent(removeReceipt, 'CallbackRemoved', { expectedArgs: { callback: nextCallback, atIndex: bn(removePos) } })
        assertAmountOfEvents(removeReceipt, 'CallbackRemoved', { expectedAmount: 1 })

        const newLen = removePos
        assertBn(await compositeReceiver.callbacksLength(), bn(newLen))

        for (let j = 0; j < newLen; j++) {
          assertBn(await compositeReceiver.callbacks(bn(j)), callbackMocks[j])
        }
      }
    })

    it(`batch callback add and remove at arbitrary positions calls work`, async () => {
      for (let id = 0; id < deployedCallbackCount; id++) {
        await compositeReceiver.addCallback(callbackMocks[id], { from: voting })
      }

      const indexesToRemove = [2, 5, 0, 6]
      while (indexesToRemove.length > 0) {
        const nextIndex = indexesToRemove.pop()

        await compositeReceiver.removeCallback(bn(nextIndex), { from: voting })
        callbackMocks.splice(nextIndex, 1)
      }

      assertBn(await compositeReceiver.callbacksLength(), bn(callbackMocks.length))

      for (let id = 0; id < callbackMocks.length; id++) {
        assertBn(await compositeReceiver.callbacks(bn(id)), callbackMocks[id])
      }
    })

    it(`batch mixed callback add/remove calls work`, async () => {
      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })
      await compositeReceiver.addCallback(callbackMocks[1], { from: voting })
      await compositeReceiver.removeCallback(bn(0), { from: voting })
      await compositeReceiver.addCallback(callbackMocks[2], { from: voting })
      await compositeReceiver.removeCallback(bn(1), { from: voting })
      await compositeReceiver.addCallback(callbackMocks[3], { from: voting })
      await compositeReceiver.addCallback(callbackMocks[4], { from: voting })

      assertBn(await compositeReceiver.callbacksLength(), bn(3))
      assertBn(await compositeReceiver.callbacks(bn(0)), callbackMocks[1])
      assertBn(await compositeReceiver.callbacks(bn(1)), callbackMocks[3])
      assertBn(await compositeReceiver.callbacks(bn(2)), callbackMocks[4])

      await compositeReceiver.removeCallback(2, { from: voting })
      await compositeReceiver.removeCallback(0, { from: voting })
      await compositeReceiver.removeCallback(0, { from: voting })

      assertBn(await compositeReceiver.callbacksLength(), bn(0))
    })

    it(`remove using out of range index reverts`, async () => {
      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })

      assertRevert(compositeReceiver.removeCallback(bn(1), { from: voting }), `INDEX_IS_OUT_OF_RANGE`)

      await compositeReceiver.addCallback(callbackMocks[1], { from: voting })
      await compositeReceiver.addCallback(callbackMocks[2], { from: voting })
      await compositeReceiver.removeCallback(bn(2), { from: voting })

      assertRevert(compositeReceiver.removeCallback(bn(2), { from: voting }), `INDEX_IS_OUT_OF_RANGE`)
    })

    it(`max callbacks count limit works`, async () => {
      // add 16 callbacks
      for (let id = 0; id < deployedCallbackCount; id++) {
        await compositeReceiver.addCallback(callbackMocks[id], { from: voting })
        await compositeReceiver.addCallback(callbackMocks[id], { from: voting })
      }

      // should fail cause we have a 16 callbacks limit (MAX_CALLBACKS_COUNT)
      assertRevert(compositeReceiver.addCallback(callbackMocks[0], { from: voting }), `MAX_CALLBACKS_COUNT_EXCEEDED`)
    })
  })

  describe('insert callbacks', async () => {
    it(`simple insert works`, async () => {
      const insertReceipt = await compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: voting })

      assertAmountOfEvents(insertReceipt, 'CallbackAdded', { expectedAmount: 1 })

      assertBn(await compositeReceiver.callbacksLength(), bn(1))
      assertBn(await compositeReceiver.callbacks(bn(0)), callbackMocks[0])
    })

    it(`batch callback insert in a direct order works`, async () => {
      for (let id = 0; id < deployedCallbackCount; ++id) {
        const nextCallback = callbackMocks[id]
        const insertReceipt = await compositeReceiver.insertCallback(nextCallback, id, { from: voting })

        assertAmountOfEvents(insertReceipt, 'CallbackAdded', { expectedAmount: 1 })

        assertBn(await compositeReceiver.callbacksLength(), bn(id + 1))
        assertBn(await compositeReceiver.callbacks(bn(id)), nextCallback)
      }

      for (let id = 0; id < deployedCallbackCount; ++id) {
        const nextCallback = callbackMocks[id]

        assertBn(await compositeReceiver.callbacks(bn(id)), nextCallback)
      }
    })

    it(`batch callback insert in a reverse order works`, async () => {
      for (let id = 0; id < deployedCallbackCount; ++id) {
        const nextCallback = callbackMocks[id]
        const insertReceipt = await compositeReceiver.insertCallback(nextCallback, 0, { from: voting })

        assertAmountOfEvents(insertReceipt, 'CallbackAdded', { expectedAmount: 1 })

        assertBn(await compositeReceiver.callbacksLength(), bn(id + 1))
        assertBn(await compositeReceiver.callbacks(bn(0)), nextCallback)
      }

      for (let id = 0; id < deployedCallbackCount; ++id) {
        const nextCallback = callbackMocks[deployedCallbackCount - id - 1]

        assertBn(await compositeReceiver.callbacks(bn(id)), nextCallback)
      }
    })

    it(`batch callback insert in an arbitrary order works`, async () => {
      await compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[1], bn(0), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[2], bn(1), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[3], bn(0), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[4], bn(2), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[5], bn(5), { from: voting })

      const expectedArr = [3, 1, 4, 2, 0, 5]

      for (let id = 0; id < expectedArr.length; id++) {
        assertBn(await compositeReceiver.callbacks(bn(id)), callbackMocks[expectedArr[id]])
      }
    })

    it(`insert using out of range index reverts`, async () => {
      assertRevert(compositeReceiver.insertCallback(callbackMocks[0], bn(1), { from: voting }), `INDEX_IS_OUT_OF_RANGE`)

      await compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[1], bn(0), { from: voting })

      assertRevert(compositeReceiver.insertCallback(callbackMocks[2], bn(3), { from: voting }), `INDEX_IS_OUT_OF_RANGE`)

      await compositeReceiver.insertCallback(callbackMocks[2], bn(0), { from: voting })
      await compositeReceiver.insertCallback(callbackMocks[3], bn(3), { from: voting })
    })
  })

  describe('a callback invocation loop', async () => {
    it(`empty callbacks list works`, async () => {
      await compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: oracle })
    })

    it(`one callback invocation works`, async () => {
      const callback = callbackMocks[2]
      await compositeReceiver.addCallback(callback, { from: voting })

      const callbackInstance = await BeaconReceiverMock.at(callback)

      assertBn(await callbackInstance.id(), bn(2))

      assertBn(await callbackInstance.processedCounter(), bn(0))
      await compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: oracle })
      assertBn(await callbackInstance.processedCounter(), bn(1))
    })

    it(`batch callback invocation works`, async () => {
      const insertOrderArray = [0, 1, 0, 2]

      for (let id = 0; id < insertOrderArray.length; id++) {
        await compositeReceiver.insertCallback(callbackMocks[id], bn(insertOrderArray[id]), { from: voting })
      }

      for (let id = 0; id < insertOrderArray.length; id++) {
        const callbackInstance = await BeaconReceiverMock.at(await compositeReceiver.callbacks(bn(id)))
        assertBn(await callbackInstance.processedCounter(), bn(0))
      }

      await compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: oracle })

      for (let id = 0; id < insertOrderArray.length; id++) {
        const callbackInstance = await BeaconReceiverMock.at(await compositeReceiver.callbacks(bn(id)))
        assertBn(await callbackInstance.processedCounter(), bn(1))
      }

      await compositeReceiver.processLidoOracleReport(bn(101), bn(105), bn(205), { from: oracle })

      for (let id = 0; id < insertOrderArray.length; id++) {
        const callbackInstance = await BeaconReceiverMock.at(await compositeReceiver.callbacks(bn(id)))
        assertBn(await callbackInstance.processedCounter(), bn(2))
      }
    })
  })

  describe('permission modifiers', async () => {
    it(`addCallback permission modifier works`, async () => {
      assertRevert(compositeReceiver.addCallback(callbackMocks[0], { from: deployer }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.addCallback(callbackMocks[0], { from: oracle }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.addCallback(callbackMocks[0], { from: anotherAccount }), `MSG_SENDER_MUST_BE_VOTING`)

      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })
    })

    it(`insertCallback permission modifier works`, async () => {
      assertRevert(compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: deployer }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: oracle }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: anotherAccount }), `MSG_SENDER_MUST_BE_VOTING`)

      await compositeReceiver.insertCallback(callbackMocks[0], bn(0), { from: voting })
    })

    it(`removeCallback permission modifier works`, async () => {
      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })

      assertRevert(compositeReceiver.removeCallback(bn(0), { from: deployer }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.removeCallback(bn(0), { from: oracle }), `MSG_SENDER_MUST_BE_VOTING`)

      assertRevert(compositeReceiver.removeCallback(bn(0), { from: anotherAccount }), `MSG_SENDER_MUST_BE_VOTING`)

      await compositeReceiver.removeCallback(bn(0), { from: voting })
    })

    it(`processLidoOracleReport permission modifier works`, async () => {
      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })

      assertRevert(compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: deployer }), `MSG_SENDER_MUST_BE_ORACLE`)

      assertRevert(
        compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: anotherAccount }),
        `MSG_SENDER_MUST_BE_ORACLE`
      )

      assertRevert(compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: voting }), `MSG_SENDER_MUST_BE_ORACLE`)

      await compositeReceiver.processLidoOracleReport(bn(100), bn(101), bn(200), { from: oracle })
    })

    it(`view functions (getters) work for everyone in a permissionless way`, async () => {
      await compositeReceiver.addCallback(callbackMocks[0], { from: voting })

      const accounts = [oracle, voting, anotherAccount, deployer]

      while (accounts.length > 0) {
        const nextAccount = accounts.pop()

        assertBn(await compositeReceiver.VOTING({ from: nextAccount }), voting)
        assertBn(await compositeReceiver.ORACLE({ from: nextAccount }), oracle)
        assertBn(await compositeReceiver.callbacks(bn(0), { from: nextAccount }), callbackMocks[0])
        assertBn(await compositeReceiver.callbacksLength({ from: nextAccount }), bn(1))
      }
    })
  })
})
