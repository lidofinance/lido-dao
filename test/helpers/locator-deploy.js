
const DUMMY_ADDRESS = '0x' + 'f'.repeat(40)

const invalidButNonZeroLocatorConfig = {
  accountingOracle: DUMMY_ADDRESS,
  depositSecurityModule: DUMMY_ADDRESS,
  elRewardsVault: DUMMY_ADDRESS,
  legacyOracle: DUMMY_ADDRESS,
  lido: DUMMY_ADDRESS,
  oracleReportSanityChecker: DUMMY_ADDRESS,
  postTokenRebaseReceiver: DUMMY_ADDRESS,
  selfOwnedStEthBurner: DUMMY_ADDRESS,
  stakingRouter: DUMMY_ADDRESS,
  treasury: DUMMY_ADDRESS,
  validatorExitBus: DUMMY_ADDRESS,
  withdrawalQueue: DUMMY_ADDRESS,
  withdrawalVault: DUMMY_ADDRESS,
}


async function deployBehindOssifiableProxy(artifactName, proxyOwner, constructorArgs=[]) {
  const Contract = await artifacts.require(artifactName)
  const implementation = (await Contract.new(...constructorArgs, { from: proxyOwner })).address

  const OssifiableProxy = await artifacts.require("OssifiableProxy")
  const proxy = await OssifiableProxy.new(implementation, proxyOwner, [], { from: proxyOwner })

  return proxy.address
}

async function updateProxyImplementation(proxyAddress, artifactName, proxyOwner, constructorArgs) {
  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.at(proxyAddress)

  const Contract = await artifacts.require(artifactName)
  const implementation = await Contract.new(...constructorArgs, { from: proxyOwner })

  await proxy.proxy__upgradeTo(implementation.address, { from: proxyOwner })
}

async function getLocatorConfig(locatorAddress) {
  console.log({locatorAddress})
  const LidoLocator = await artifacts.require('LidoLocator')
  const locator = await LidoLocator.at(locatorAddress)
  const config = {
    accountingOracle: await locator.accountingOracle(),
    depositSecurityModule: await locator.depositSecurityModule(),
    elRewardsVault: await locator.elRewardsVault(),
    legacyOracle: await locator.legacyOracle(),
    lido: await locator.lido(),
    oracleReportSanityChecker: await locator.oracleReportSanityChecker(),
    postTokenRebaseReceiver: await locator.postTokenRebaseReceiver(),
    selfOwnedStEthBurner: await locator.postTokenRebaseReceiver(),
    stakingRouter: await locator.stakingRouter(),
    treasury: await locator.treasury(),
    validatorExitBus: await locator.validatorExitBus(),
    withdrawalQueue: await locator.withdrawalQueue(),
    withdrawalVault: await locator.withdrawalVault(),
  }
  return config
}

async function deployLocatorWithInvalidImplementation(admin) {
  return await deployBehindOssifiableProxy('DummyEmptyContract', admin)
}

///! Not specified in configUpdate values are set to dummy non zero addresses
async function updateLocatorImplementation(locator, admin, configUpdate={}) {
  let config = invalidButNonZeroLocatorConfig
  config = Object.assign({}, config, configUpdate)
  await updateProxyImplementation(locator, 'LidoLocator', admin, [config])
}

module.exports = {
  deployLocatorWithInvalidImplementation,
  updateLocatorImplementation,
  getLocatorConfig,
}
