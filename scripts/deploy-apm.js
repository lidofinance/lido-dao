const { hash: namehash } = require('eth-ens-namehash')
const keccak256 = require('js-sha3').keccak_256
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const logDeploy = require('./helpers/log-deploy')
const { ZERO_ADDR, errorOut } = require('./helpers')

const globalArtifacts = this.artifacts || artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 || web3 // Not injected unless called directly via truffle

const TLD_NAME = 'eth'
const LABEL_NAME = 'depoolspm'

const defaultOwner = process.env.OWNER
const defaultDaoFactoryAddress = process.env.DAO_FACTORY || '0x5d94e3e7aec542ab0f9129b9a7badeb5b3ca0f77'
const defaultENSAddress = process.env.ENS || '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'

async function deploy({
  artifacts = globalArtifacts,
  web3 = globalWeb3,
  ensAddress = defaultENSAddress,
  owner = defaultOwner,
  daoFactoryAddress = defaultDaoFactoryAddress,
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

  const accounts = await getAccounts(web3)
  if (!owner) {
    owner = accounts[0]
    log("OWNER env variable not found, setting owner to the provider's first account")
  }
  log('Owner:', owner)

  const APMRegistry = artifacts.require('APMRegistry')
  const Repo = artifacts.require('Repo')
  const ENSSubdomainRegistrar = artifacts.require('ENSSubdomainRegistrar')
  const DAOFactory = artifacts.require('DAOFactory')
  const APMRegistryFactory = artifacts.require('APMRegistryFactory')
  const ENS = artifacts.require('ENS')

  const daoFactory = await DAOFactory.at(daoFactoryAddress)
  const hasEVMScripts = (await daoFactory.regFactory()) !== ZERO_ADDR
  log(`Using provided DAOFactory (with${hasEVMScripts ? '' : 'out'} EVMScripts):`, daoFactoryAddress)
  const ens = await ENS.at(ensAddress)
  log(`Using provided ENS: ${ensAddress}`)

  const tldName = TLD_NAME
  const labelName = LABEL_NAME
  const tldHash = namehash(tldName)
  const labelHash = '0x' + keccak256(labelName)
  const apmNode = namehash(`${labelName}.${tldName}`)

  log(`TLD: ${tldName} (${tldHash})`)
  log(`Label: ${labelName} (${labelHash})`)
  log('=========')
  log('Deploying APM bases...')

  const apmRegistryBase = await APMRegistry.new({ from: owner })
  await logDeploy('APMRegistry', apmRegistryBase)
  const apmRepoBase = await Repo.new({ from: owner })
  await logDeploy('Repo', apmRepoBase)
  const ensSubdomainRegistrarBase = await ENSSubdomainRegistrar.new({ from: owner })
  await logDeploy('ENSSubdomainRegistrar', ensSubdomainRegistrarBase)

  log('Deploying APMRegistryFactory...')
  const apmFactory = await APMRegistryFactory.new(
    daoFactory.address,
    apmRegistryBase.address,
    apmRepoBase.address,
    ensSubdomainRegistrarBase.address,
    ens.address,
    ZERO_ADDR,
    { from: owner }
  )
  await logDeploy('APMRegistryFactory', apmFactory)

  log(`Assigning ENS name (${labelName}.${tldName}) to factory...`)

  if ((await ens.owner(apmNode)) === owner) {
    log('Transferring name ownership from deployer to APMRegistryFactory')
    await ens.setOwner(apmNode, apmFactory.address)
  } else {
    log('Creating subdomain and assigning it to APMRegistryFactory')
    try {
      await ens.setSubnodeOwner(tldHash, labelHash, apmFactory.address, { from: owner })
    } catch (err) {
      console.error(
        `Error: could not set the owner of '${labelName}.${tldName}' on the given ENS instance`,
        `(${ens.address}). Make sure you have ownership rights over the subdomain.`
      )
      throw err
    }
  }

  log('Deploying APM...')
  const receipt = await apmFactory.newAPM(tldHash, labelHash, owner, { from: owner })

  log('=========')
  const apmAddress = receipt.logs.filter((l) => l.event === 'DeployAPM')[0].args.apm
  log('# APM:')
  log('Address:', apmAddress)
  log('Transaction hash:', receipt.tx)
  log('=========')

  return {
    apm: apmAddress
  }
}

module.exports = runOrWrapScript(deploy, module)
