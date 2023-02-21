const { artifacts } = require('hardhat')

const LidoLocator = artifacts.require('LidoLocator')

const DUMMY_ADDRESS = '0x' + 'f'.repeat(40)

const invalidButNonZeroLocatorConfig = {
  accountingOracle: DUMMY_ADDRESS,
  depositSecurityModule: DUMMY_ADDRESS,
  elRewardsVault: DUMMY_ADDRESS,
  legacyOracle: DUMMY_ADDRESS,
  lido: DUMMY_ADDRESS,
  oracleReportSanityChecker: DUMMY_ADDRESS,
  postTokenRebaseReceiver: DUMMY_ADDRESS,
  burner: DUMMY_ADDRESS,
  stakingRouter: DUMMY_ADDRESS,
  treasury: DUMMY_ADDRESS,
  validatorsExitBusOracle: DUMMY_ADDRESS,
  withdrawalQueue: DUMMY_ADDRESS,
  withdrawalVault: DUMMY_ADDRESS,
  oracleDaemonConfig: DUMMY_ADDRESS,
}

async function deployBehindOssifiableProxy(artifactName, proxyOwner, constructorArgs = []) {
  const Contract = await artifacts.require(artifactName)
  const implementation = (await Contract.new(...constructorArgs, { from: proxyOwner })).address

  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.new(implementation, proxyOwner, [], { from: proxyOwner })

  return proxy
}

async function updateProxyImplementation(proxyAddress, artifactName, proxyOwner, constructorArgs) {
  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.at(proxyAddress)

  const Contract = await artifacts.require(artifactName)
  const implementation = await Contract.new(...constructorArgs, { from: proxyOwner })

  await proxy.proxy__upgradeTo(implementation.address, { from: proxyOwner })
}

async function getLocatorConfig(locatorAddress) {
  const locator = await LidoLocator.at(locatorAddress)
  const config = {
    accountingOracle: await locator.accountingOracle(),
    depositSecurityModule: await locator.depositSecurityModule(),
    elRewardsVault: await locator.elRewardsVault(),
    legacyOracle: await locator.legacyOracle(),
    lido: await locator.lido(),
    oracleReportSanityChecker: await locator.oracleReportSanityChecker(),
    postTokenRebaseReceiver: await locator.postTokenRebaseReceiver(),
    burner: await locator.burner(),
    stakingRouter: await locator.stakingRouter(),
    treasury: await locator.treasury(),
    validatorsExitBusOracle: await locator.validatorsExitBusOracle(),
    withdrawalQueue: await locator.withdrawalQueue(),
    withdrawalVault: await locator.withdrawalVault(),
    oracleDaemonConfig: await locator.oracleDaemonConfig(),
  }
  return config
}

async function deployLocatorWithInvalidImplementation(admin) {
  return await deployBehindOssifiableProxy('DummyEmptyContract', admin)
}

async function deployLocatorWithDummyAddressesImplementation(admin) {
  const proxy = await deployBehindOssifiableProxy('LidoLocator', admin, [invalidButNonZeroLocatorConfig])
  return await LidoLocator.at(proxy.address)
}

/// ! Not specified in configUpdate values are set to dummy non zero addresses
async function updateLocatorImplementation(locatorAddress, admin, configUpdate = {}) {
  const config = await getLocatorConfig(locatorAddress)
  Object.assign(config, configUpdate)
  await updateProxyImplementation(locatorAddress, 'LidoLocator', admin, [config])
}

module.exports = {
  deployLocatorWithInvalidImplementation,
  updateLocatorImplementation,
  getLocatorConfig,
  deployLocatorWithDummyAddressesImplementation,
}
