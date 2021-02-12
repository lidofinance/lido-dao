const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const { log, logSplitter, logTx } = require('../helpers/log')
const { isZeroAddress } = require('../helpers/address')

const { assignENSName, resolveEnsAddress } = require('./ens')

async function deployAPM({ web3, artifacts, owner, labelName, ens, apmRegistryFactory, apmRegistryAddress }) {
  const APMRegistry = artifacts.require('APMRegistry')
  if (apmRegistryAddress) {
    log(`Using APMRegistry: ${chalk.yellow(apmRegistryAddress)}`)
    const apmRegistry = await APMRegistry.at(apmRegistryAddress)
    return { apmRegistry }
  }

  log(`Deploying APM for node ${labelName}.eth...`)

  logSplitter()
  const { parentNode, labelHash, nodeName, node } = await assignENSName({
    parentName: 'eth',
    labelName,
    owner,
    ens,
    assigneeAddress: apmRegistryFactory.address,
    assigneeDesc: 'APMRegistryFactory'
  })

  logSplitter()
  log(`Using APMRegistryFactory: ${chalk.yellow(apmRegistryFactory.address)}`)
  const receipt = await logTx(`Deploying APMRegistry`, apmRegistryFactory.newAPM(parentNode, labelHash, owner))
  const apmAddr = receipt.logs.filter((l) => l.event === 'DeployAPM')[0].args.apm
  log(`APMRegistry address: ${chalk.yellow(apmAddr)}`)
  logSplitter()

  const apmRegistry = await APMRegistry.at(apmAddr)

  return {
    apmRegistry,
    ensNodeName: nodeName,
    ensNode: node
  }
}

async function resolveLatestVersion(ensNode, ens, artifacts) {
  const repoAddress = await resolveEnsAddress(artifacts, ens, ensNode)
  if (isZeroAddress(repoAddress)) {
    return null
  }
  const repo = await artifacts.require('Repo').at(repoAddress)
  return await repo.getLatest()
}

module.exports = { deployAPM, resolveLatestVersion }
