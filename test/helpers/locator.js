const { randomBytes } = require('crypto')
const { toChecksumAddress } = require('ethereumjs-util')

const locatorServices = [
  'accountingOracle',
  'depositSecurityModule',
  'elRewardsVault',
  'legacyOracle',
  'lido',
  'oracleReportSanityChecker',
  'selfOwnedStEthBurner',
  'stakingRouter',
  'treasury',
  'validatorExitBus',
  'withdrawalQueue',
  'withdrawalVault',
  'postTokenRebaseReceiver'
]

function getRandomLocatorConfig(overrides = {}) {
  return locatorServices.reduce((config, current) => {
    config[current] = overrides[current] || generateRandomAddress()
    return config
  }, {})
}

function generateRandomAddress() {
  return toChecksumAddress('0x' + randomBytes(20).toString('hex'))
}

module.exports = {
  getRandomLocatorConfig,
  locatorServices
}
