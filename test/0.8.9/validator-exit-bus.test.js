const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { waitBlocks } = require('../helpers/blockchain')

const { assert } = require('chai')

const ValidatorExitBus = artifacts.require('ValidatorExitBus.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
// semantic aliases

const e18 = 10 ** 18
const blockDurationSeconds = 12
const secondsInDay = 24 * 60 * 60
const blocksInDay = secondsInDay / blockDurationSeconds

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

function fromE18(value) {
  return value / e18
}

function toE18(value) {
  return bn(value.toString()).mul(bn(e18.toString()))
}

function logE18(value) {
  console.log(`${value / e18} (${value.toString()})`)
}

function generateValidatorPubKey() {
  const pubKeyLength = 48
  return pad('0x010203', pubKeyLength)
}

function generateReportKeysArguments(numKeys, epochId) {
  const stakingModuleIds = Array.from(Array(numKeys), () => 1)
  const nodeOperatorIds = Array.from(Array(numKeys), () => 1)
  const keys = Array.from(Array(numKeys), () => generateValidatorPubKey())
  return [stakingModuleIds, nodeOperatorIds, keys, epochId]
}

const maxRequestsPerDayE18 = toE18(2000 + 1)
const numRequestsLimitIncreasePerBlockE18 = maxRequestsPerDayE18.div(bn(blocksInDay))

contract.only('ValidatorExitBus', ([deployer, member, ...otherAccounts]) => {
  let bus = null

  beforeEach('deploy bus', async () => {
    bus = await ValidatorExitBus.new(maxRequestsPerDayE18, numRequestsLimitIncreasePerBlockE18, { from: deployer })
    await bus.addOracleMember(member)
  })

  describe('Estimate gas usage', () => {
    beforeEach(async () => {})

    it(`Calculate gas usages`, async () => {
      const epochId = 123
      const gasUsage = {}
      const amountsOfKeysToTry = [1, 2, 5, 10, 50, 100, 500, 1000, 2000]
      let prevNumKeys = 0
      for (const numKeys of amountsOfKeysToTry) {
        await waitBlocks(Math.ceil(prevNumKeys / fromE18(numRequestsLimitIncreasePerBlockE18)))
        assert(numKeys <= fromE18(maxRequestsPerDayE18), 'num keys to eject is above day limit')
        const args = generateReportKeysArguments(numKeys, epochId)
        const result = await bus.reportKeysToEject(...args, { from: member })
        gasUsage[numKeys] = result.receipt.gasUsed
        prevNumKeys = numKeys
      }

      console.log(gasUsage)
    })
  })

  describe('Rate limit tests', () => {
    beforeEach(async () => {})

    it(`Report one key`, async () => {
      const epochId = 123
      await bus.reportKeysToEject([1], [2], [generateValidatorPubKey()], epochId, { from: member })
    })

    it.skip(`Revert if length of arrays reported differ`, async () => {
      // TODO
      const epochId = 123
      await bus.reportKeysToEject([], [2], [generateValidatorPubKey()], epochId, { from: member })
    })

    it(`Revert if exceeds limit after multiple consecutive tx`, async () => {
      const epochId = 123
      const maxLimit = fromE18(await bus.getMaxLimit())
      let numKeysReportedTotal = 0
      const startBlockNumber = (await web3.eth.getBlock('latest')).number

      const keysPerIteration = Math.floor(maxLimit / 20)
      while (maxLimit > numKeysReportedTotal) {
        const numKeys = Math.min(keysPerIteration, maxLimit - numKeysReportedTotal)
        await bus.reportKeysToEject(...generateReportKeysArguments(numKeys, epochId), { from: member })
        numKeysReportedTotal += numKeys
      }

      const numBlocksPassed = (await web3.eth.getBlock('latest')).number - startBlockNumber
      const numExcessKeys = Math.ceil(numBlocksPassed * fromE18(numRequestsLimitIncreasePerBlockE18)) + 1
      assertRevert(bus.reportKeysToEject(...generateReportKeysArguments(numExcessKeys, epochId), { from: member }), 'RATE_LIMIT')
    })

    it(`Report max amount of keys per tx`, async () => {
      const epochId = 123
      const maxLimit = fromE18(await bus.getMaxLimit())
      console.log({ maxLimit })
      await bus.reportKeysToEject(...generateReportKeysArguments(maxLimit, epochId), { from: member })
    })

    it(`Revert if request to exit maxLimit+1 keys per tx`, async () => {
      const epochId = 123
      const maxRequestsPerDay = fromE18(await bus.getMaxLimit())
      assertRevert(bus.reportKeysToEject(...generateReportKeysArguments(maxRequestsPerDay + 1, epochId), { from: member }), 'RATE_LIMIT')
    })
  })
})
