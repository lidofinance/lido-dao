const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { waitBlocks } = require('../helpers/blockchain')

const { assert } = require('chai')

const ValidatorExitBus = artifacts.require('ValidatorExitBusMock.sol')

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

const stakingModuleId = ZERO_ADDRESS

function generateReportKeysArguments(numKeys, epochId) {
  const stakingModuleIds = Array.from(Array(numKeys), () => stakingModuleId)
  const validatorIds = Array.from(Array(numKeys), () => 123)
  const nodeOperatorIds = Array.from(Array(numKeys), () => 1)
  const keys = Array.from(Array(numKeys), () => generateValidatorPubKey())
  return [epochId, stakingModuleIds, nodeOperatorIds, validatorIds, keys]
}

const maxRequestsPerDayE18 = toE18(2000 + 1)
const numRequestsLimitIncreasePerBlockE18 = maxRequestsPerDayE18.div(bn(blocksInDay))

function calcRateLimitParameters(maxRequestsPerDay) {
  const maxRequestsPerDayE18 = toE18(maxRequestsPerDay)
  return [toE18(maxRequestsPerDay), maxRequestsPerDayE18.div(bn(blocksInDay))]
}

const GENESIS_TIME = 1606824000

contract.skip('ValidatorExitBus', ([deployer, member, owner, nobody]) => {
  let bus = null

  const calcReportHash = async (report) => {
    return await bus.calcReportHash(...report, {from: nobody})
  }

  const doHashReport = async (epochId, report, reporter) => {
    const reportHash = await calcReportHash(report)
    return await bus.handleCommitteeMemberReport(epochId, reportHash, { from: reporter })
  }

  beforeEach('deploy bus', async () => {
    bus = await ValidatorExitBus.new({ from: deployer })

    await bus.initialize(owner, ...calcRateLimitParameters(2000), 1, 32, 12, GENESIS_TIME, { from: owner })

    await bus.setTime(GENESIS_TIME)

    // Set up the app's permissions.
    await bus.grantRole(await bus.MANAGE_MEMBERS_ROLE(), owner, { from: owner })
    await bus.grantRole(await bus.MANAGE_QUORUM_ROLE(), owner, { from: owner })
    await bus.grantRole(await bus.SET_BEACON_SPEC_ROLE(), owner, { from: owner })

    await bus.addOracleMember(member, { from: owner })
    await bus.updateQuorum(1, { from: owner })
  })

  describe('Estimate gas usage', () => {
    it(`Calculate gas usages`, async () => {
      let epochId = 1
      const gasUsage = {}
      const amountsOfKeysToTry = [1, 3, 10, 40, 100]
      let prevNumKeys = 0
      for (const numKeys of amountsOfKeysToTry) {
        await waitBlocks(Math.ceil(prevNumKeys / fromE18(numRequestsLimitIncreasePerBlockE18)))
        const args = generateReportKeysArguments(numKeys, epochId)
        const hashReportTx = await doHashReport(epochId, args, member)
        const dataReportTx = await bus.handleReportData(...args, { from: nobody })
        gasUsage[numKeys] = dataReportTx.receipt.gasUsed
        prevNumKeys = numKeys
        epochId += 1
      }

      console.log(`==== Gas usage ====`)
      for (const [numKeys, gasTotal] of Object.entries(gasUsage)) {
        const usagePerKey = gasTotal / numKeys
        console.log(`${numKeys}: ${usagePerKey} per key (${gasTotal} total)`)
      }
      console.log(`===================`)
    })
  })

  describe('Rate limit tests', () => {
    it(`Report one key`, async () => {
      const epochId = 1
      await bus.handleCommitteeMemberReport([stakingModuleId], [2], [123], [generateValidatorPubKey()], epochId, { from: member })
    })

    it.skip(`Revert if length of arrays reported differ`, async () => {
      // TODO
      const epochId = 1
      await bus.handleCommitteeMemberReport([], [2], [generateValidatorPubKey()], epochId, { from: member })
    })

    it(`Revert if exceeds limit after multiple consecutive tx`, async () => {
      let epochId = 1
      const maxLimit = fromE18(await bus.getMaxLimit())
      let numKeysReportedTotal = 0
      const startBlockNumber = (await web3.eth.getBlock('latest')).number

      const keysPerIteration = 100
      while (maxLimit > numKeysReportedTotal) {
        const numKeys = Math.min(keysPerIteration, maxLimit - numKeysReportedTotal)
        await bus.handleCommitteeMemberReport(...generateReportKeysArguments(numKeys, epochId), { from: member })
        numKeysReportedTotal += numKeys
        epochId += 1
      }

      const numBlocksPassed = (await web3.eth.getBlock('latest')).number - startBlockNumber
      const numExcessKeys = Math.ceil(numBlocksPassed * fromE18(numRequestsLimitIncreasePerBlockE18)) + 1
      assertRevert(bus.handleCommitteeMemberReport(...generateReportKeysArguments(numExcessKeys, epochId), { from: member }), 'RATE_LIMIT')
    })

    it(`Report max amount of keys per tx`, async () => {
      const epochId = 1
      await bus.setRateLimit(...calcRateLimitParameters(100))
      const maxLimit = fromE18(await bus.getMaxLimit())
      await bus.handleCommitteeMemberReport(...generateReportKeysArguments(maxLimit, epochId), { from: member })
    })

    it.skip(`Revert if request to exit maxLimit+1 keys per tx`, async () => {
      const epochId = 1
      await bus.setRateLimit(...calcRateLimitParameters(100))
      const maxRequestsPerDay = fromE18(await bus.getMaxLimit())
      assertRevert(
        bus.handleCommitteeMemberReport(...generateReportKeysArguments(maxRequestsPerDay + 1, epochId), { from: member }),
        'RATE_LIMIT'
      )
    })
  })

  describe('Not responded validators tests', () => {
    it(`Report not responded validator happy path`, async () => {
      const epochId = 1
      await bus.setRateLimit(...calcRateLimitParameters(100))
      const maxLimit = fromE18(await bus.getMaxLimit())
      await bus.handleCommitteeMemberReport(...generateReportKeysArguments(maxLimit, epochId), { from: member })
    })
  })
})
