const { hash: namehash } = require('eth-ens-namehash')
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const apps = require('./helpers/apps')
const runOrWrapScript = require('./helpers/run-or-wrap-script')
const logDeploy = require('./helpers/log-deploy')

const globalArtifacts = this.artifacts || artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 || web3 // Not injected unless called directly via truffle

const errorOut = (message) => {
  console.error(message)
  throw new Error(message)
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

const lidoTemplateName = 'lido-template'
const lidoTld = `lido.eth`

const defaultOwner = process.env.OWNER
const defaultDaoFactoryAddress = process.env.DAO_FACTORY || '0x5d94e3e7aec542ab0f9129b9a7badeb5b3ca0f77'
const defaultENSAddress = process.env.ENS || '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'
const defaultMiniMeFactoryAddress = process.env.MENIME_FACTORY || '0xd526b7aba39cccf76422835e7fd5327b98ad73c9'
const defaultApmRegistryAddress = process.env.APM || '0x1902a0410EFe699487Dd85F12321aD672bE4ada2' // lido
const defaultAragonIdAddress = process.env.ARAGON_ID || ''

const _getRegistered = async (ens, hash) => {
  const owner = await ens.owner(hash)
  return owner !== ZERO_ADDR && owner !== '0x' ? owner : false
}

async function deploy({
  artifacts = globalArtifacts,
  web3 = globalWeb3,
  ensAddress = defaultENSAddress,
  owner = defaultOwner,
  daoFactoryAddress = defaultDaoFactoryAddress,
  miniMeFactoryAddress = defaultMiniMeFactoryAddress,
  apmRegistryAddress = defaultApmRegistryAddress,
  aragonIdAddress = defaultAragonIdAddress,
  verbose = true
} = {}) {
  const log = (...args) => {
    if (verbose) {
      console.log(...args)
    }
  }

  if (!web3)
    errorOut('Missing "web3" object. This script must be run with a "web3" object globally defined, for example through "truffle exec".')
  if (!artifacts)
    errorOut(
      'Missing "artifacts" object. This script must be run with an "artifacts" object globally defined, for example through "truffle exec".'
    )
  if (!ensAddress) errorOut('Missing ENS address. Please specify one using ENS env var')
  if (!daoFactoryAddress) errorOut('Missing DAO Factory address. Please specify one using DAO_FACTORY env var')
  if (!miniMeFactoryAddress) errorOut('Missing MiniMe Factory address. Please specify one using MENIME_FACTORY env var')
  if (!apmRegistryAddress) errorOut('Missing APM Registry address. Please specify one using APM env var')

  const accounts = await getAccounts(web3)
  if (!owner) {
    owner = accounts[0]
    log("OWNER env variable not found, setting owner to the provider's first account")
  }
  log('Owner:', owner)

  const APMRegistry = artifacts.require('APMRegistry')
  const ENS = artifacts.require('ENS')
  const LidoTemplate = artifacts.require('LidoTemplate')

  const ens = await ENS.at(ensAddress)
  log(`Using provided ENS: ${ens.address}`)

  const apm = await APMRegistry.at(apmRegistryAddress)
  log(`Using provided APM Registry: ${apm.address}`)

  if (!aragonIdAddress) {
    aragonIdAddress = await _getRegistered(ens, namehash('aragonid.eth'))
    if (aragonIdAddress) {
      log(`Using aragonID registered at aragonid.eth: ${aragonIdAddress}`)
    } else {
      errorOut('Aragon ID address not found. Please specify one using ARAGON_ID env var')
    }
  } else {
    log(`Using provided aragonID: ${aragonIdAddress}`)
  }

  log('=========')
  log('Check Apps...')

  for (const { name, tld, contractName } of apps) {
    if (await _getRegistered(ens, namehash(`${name}.${tld}`))) {
      log(`Using registered ${contractName} app`)
    } else {
      errorOut(`No ${contractName} app registered`)
    }
  }
  if (await _getRegistered(ens, namehash(`${lidoTemplateName}.${lidoTld}`))) {
    errorOut('Template already registered')
  }

  log(`Deploying template: ${lidoTemplateName}`)
  const template = await LidoTemplate.new(daoFactoryAddress, ensAddress, miniMeFactoryAddress, aragonIdAddress, { gas: 6000000 })
  await logDeploy('LidoTemplate', template)

  log(`Deployed LidoTemplate: ${template.address}`)

  log(`Registering package for LidoTemplate as "${lidoTemplateName}.${lidoTld}"`)
  const receipt = await apm.newRepoWithVersion(lidoTemplateName, owner, [1, 0, 0], template.address, '0x0', { from: owner })
  // log(receipt)

  return {
    template: template.address
  }
}

module.exports = runOrWrapScript(deploy, module)
