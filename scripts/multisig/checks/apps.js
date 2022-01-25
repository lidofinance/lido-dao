const chalk = require('chalk')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const { log } = require('../../helpers/log')
const { assert } = require('../../helpers/assert')
const { loadArtifact } = require('../../helpers/artifacts')
const { assertProxiedContractBytecode } = require('../../helpers/deploy')

const { APP_NAMES, APP_ARTIFACTS } = require('../constants')

const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

async function assertInstalledApps(
  {
    template,
    dao: kernel,
    lidoApmEnsName,
    appProxyUpgradeableArtifactName = 'external:AppProxyUpgradeable',
    aragonAppArtifactName = 'AragonApp'
  },
  fromBlock = 4532202
) {
  const appInstalledEvts = (await template.getPastEvents('TmplAppInstalled', { fromBlock })).map((evt) => evt.args)
  const appIdNameEntries = VALID_APP_NAMES.map((name) => [namehash(`${name}.${lidoApmEnsName}`), name])
  const appNameByAppId = Object.fromEntries(appIdNameEntries)
  const expectedAppIds = appIdNameEntries.map((e) => e[0])

  const idsCheckDesc = `all (and only) expected apps are installed`
  assert.sameMembers(
    appInstalledEvts.map((evt) => evt.appId),
    expectedAppIds,
    idsCheckDesc
  )
  log.success(idsCheckDesc)

  const proxyArtifact = await loadArtifact(appProxyUpgradeableArtifactName, network.name)
  const AragonApp = artifacts.require(aragonAppArtifactName)
  const APP_BASES_NAMESPACE = await kernel.APP_BASES_NAMESPACE()

  const dataByAppName = {}

  for (const evt of appInstalledEvts) {
    log.splitter()

    const appName = appNameByAppId[evt.appId]
    const proxyAddress = toChecksumAddress(evt.appProxy)

    const artifact = await loadArtifact(APP_ARTIFACTS[appName], network.name)
    const implAddress = await assertProxiedContractBytecode(proxyAddress, proxyArtifact, artifact, appName)

    const kernelBaseAddr = await kernel.getApp(APP_BASES_NAMESPACE, evt.appId)

    const baseCheckDesc = `${appName}: the installed app base is ${chalk.yellow(implAddress)}`
    assert.equal(toChecksumAddress(kernelBaseAddr), toChecksumAddress(implAddress), baseCheckDesc)
    log.success(baseCheckDesc)

    const instance = await AragonApp.at(proxyAddress)
    await assertInitializedAragonApp(instance, kernel, appName)

    dataByAppName[appName] = {
      name: appName,
      fullName: `${appName}.${lidoApmEnsName}`,
      id: evt.appId,
      proxyAddress
    }
  }

  return dataByAppName
}

async function assertInitializedAragonApp(instance, kernel, desc) {
  const initCheckDesc = `${desc}: is an initialized Aragon app`
  assert.equal(await instance.hasInitialized(), true, initCheckDesc)
  log.success(initCheckDesc)

  const kernelCheckDesc = `${desc} kernel: ${chalk.yellow(kernel.address)}`
  const appKernel = toChecksumAddress(await instance.kernel())
  assert.equal(appKernel, toChecksumAddress(kernel.address), kernelCheckDesc)
  log.success(kernelCheckDesc)
}

module.exports = { assertInstalledApps, VALID_APP_NAMES }
