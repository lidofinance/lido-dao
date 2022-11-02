const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { assert } = require('chai')

const ValidatorExitBus = artifacts.require('ValidatorExitBus.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
// semantic aliases

const e18 = 10 ** 18

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

function fromE18(value) {
  return Math.floor(value / e18)
}

function logE18(value) {
  console.log(`${value / e18} (${value.toString()})`)
}

function generateValidatorPubKey() {
  const pubKeyLength = 48
  return pad('0x010203', pubKeyLength)
}

function generateReportKeysArguments(numKeys) {
  var stakingModuleIds = Array.from(Array(numKeys), () => 1)
  var nodeOperatorIds = Array.from(Array(numKeys), () => 1)
  var keys = Array.from(Array(numKeys), () => generateValidatorPubKey())
  return [stakingModuleIds, nodeOperatorIds, keys]
}

contract('ValidatorExitBus', ([deployer, member, ...otherAccounts]) => {
  let bus = null

  beforeEach('deploy bus', async () => {
    bus = await ValidatorExitBus.new({ from: deployer })
    await bus.addOracleMember(member)
  })

  describe('Estimate gas usage', () => {
    beforeEach(async () => {})

    it(`Calculate gas usages`, async () => {
      const gasUsage = {}
      const amountsOfKeysToTry = [1, 2, 5, 10, 50, 100, 500, 1000, 2000]
      for (const numKeys of amountsOfKeysToTry) {
        const result = await bus.reportKeysToEject(...generateReportKeysArguments(numKeys), { from: member })
        gasUsage[numKeys] = result.receipt.gasUsed
      }
      console.log(gasUsage)
    })
  })

  describe('Rate limit tests', () => {
    beforeEach(async () => {})

    it(`Report one key`, async () => {
      await bus.reportKeysToEject([1], [2], [generateValidatorPubKey()], { from: member })
    })

    it(`Revert if exceeds limit`, async () => {
      const maxLimit = fromE18(await bus.getMaxLimit())
      let numKeysReportedTotal = 0
      const keysPerIteration = Math.floor(maxLimit / 20)
      while (maxLimit > numKeysReportedTotal) {
        const keysToEject = Math.min(keysPerIteration, maxLimit - numKeysReportedTotal)
        await bus.reportKeysToEject(...generateReportKeysArguments(keysToEject), { from: member })
        numKeysReportedTotal += keysToEject
      }

      const numExcessKeys = 10
      assertRevert(bus.reportKeysToEject(...generateReportKeysArguments(numExcessKeys), { from: member }), 'RATE_LIMIT')
    })

    it.skip(`Report max amount of keys per tx`, async () => {
      const maxLimit = fromE18(await bus.getMaxLimit())
      console.log({ maxLimit })
      await bus.reportKeysToEject(...generateReportKeysArguments(maxLimit), { from: member })
    })

    it.skip(`Revert if request to exit maxLimit+1 keys`, async () => {
      const maxLimit = fromE18(await bus.getMaxLimit())
      assertRevert(bus.reportKeysToEject(...generateReportKeysArguments(maxLimit + 1), { from: member }), 'RATE_LIMIT')
    })
  })
})
