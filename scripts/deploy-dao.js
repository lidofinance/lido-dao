const { hash: namehash } = require('eth-ens-namehash')
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')

const { apps } = require('./helpers/apps')
const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { _getRegistered, errorOut } = require('./helpers')
const { tld, apmName, templateName, daoName } = require('./helpers/constants')

const globalArtifacts = this.artifacts || artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 || web3 // Not injected unless called directly via truffle

const apmTld = `${apmName}.${tld}`
const tmplTld = `${templateName}.${apmName}.${tld}`

const ONE_DAY = 60 * 60 * 24
const ONE_WEEK = ONE_DAY * 7
const THIRTY_DAYS = ONE_DAY * 30

const defaultOwner = process.env.OWNER
const defaultENSAddress = process.env.ENS || '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'
const defaultApmRegistryAddress = process.env.APM || '0x1902a0410EFe699487Dd85F12321aD672bE4ada2' // lido
const defaultDepositContractAddress = process.env.DEPOSIT_CONTRACT || '0x5f4e510503d83bd1a5436bdae2923489da0be454'
const defaultDepositIterationLimit = process.env.DEPOSIT_ITERATION_LIMIT || '16'

async function deploy({
  artifacts = globalArtifacts,
  web3 = globalWeb3,
  ensAddress = defaultENSAddress,
  owner = defaultOwner,
  apmRegistryAddress = defaultApmRegistryAddress,
  depositContractAddress = defaultDepositContractAddress,
  depositIterationLimit = defaultDepositIterationLimit,
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
  if (!apmRegistryAddress) errorOut('Missing APM Registry address. Please specify one using APM env var')
  if (!depositContractAddress) errorOut('Missing Deposit Contract address. Please specify one using DAO_FACTORY env var')
  if (!depositIterationLimit) errorOut('Missing Deposit iteration limit. Please specify one using DEPOSIT_ITERATION_LIMIT env var')

  const [holder1, holder2, holder3, holder4, holder5] = await getAccounts(web3)
  if (!owner) {
    owner = holder1
    log("OWNER env variable not found, setting owner to the operator's first account")
  }
  log('Owner:', owner)

  const Repo = artifacts.require('Repo')
  const PublicResolver = artifacts.require('PublicResolver')
  const ENS = artifacts.require('ENS')
  const LidoTemplate = artifacts.require('LidoTemplate')

  const ens = await ENS.at(ensAddress)
  log(`Using provided ENS: ${ens.address}`)

  log('=========')
  if (await _getRegistered(ens, namehash(`${daoName}.${apmTld}`))) {
    errorOut('DAO already registered')
  }

  const tmplNameHash = namehash(tmplTld)
  const resolverAddress = await ens.resolver(tmplNameHash)
  const resolver = await PublicResolver.at(resolverAddress)
  const repoAddress = await resolver.addr(tmplNameHash)
  const repo = await Repo.at(repoAddress)
  const latestRepo = await repo.getLatest()
  const tmplAddress = latestRepo[1]

  const template = await DePoolTemplate.at(tmplAddress)
  console.log(`Using template ${tmplTld} at:`, template.address)

  // TODO get holders from .env
  const HOLDERS = [holder1, holder2, holder3, holder4, holder5]
  const STAKES = HOLDERS.map(() => '100000000000000000000') // 100e18
  const TOKEN_NAME = 'DAO Token'
  const TOKEN_SYMBOL = 'LDO'

  // TODO get voting settings from .env
  const VOTE_DURATION = ONE_WEEK
  const SUPPORT_REQUIRED = '500000000000000000' // 50e16
  const MIN_ACCEPTANCE_QUORUM = '50000000000000000' // 5e16
  const VOTING_SETTINGS = [SUPPORT_REQUIRED, MIN_ACCEPTANCE_QUORUM, VOTE_DURATION]

  // const newInstanceTx = template.contract.methods.newDAO(TOKEN_NAME, TOKEN_SYMBOL, HOLDERS, STAKES, VOTING_SETTINGS, depositContractAddress)
  // const estimatedGas = await newInstanceTx.estimateGas()
  // log(estimatedGas)

  console.log('Deploying DAO contract...')
  const receipt = await template.newDAO(
    daoName,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    HOLDERS,
    STAKES,
    VOTING_SETTINGS,
    depositContractAddress,
    depositIterationLimit,
    {
      from: owner
    }
  )

  log('=========')
  log('Tx hash:', receipt.tx)
  log('=========')

  const tokenEvent = receipt.logs.find((l) => l.event === 'DeployToken')
  const daoEvent = receipt.logs.find((l) => l.event === 'DeployDao')
  const installedApps = receipt.logs.filter((l) => l.event === 'InstalledApp').map((l) => l.args)

  log('=========')
  log('# DAO:')
  log('Address:', daoEvent.args.dao)
  log('Share Token:', tokenEvent.args.token)
  log('=========')
  installedApps.forEach((app) => {
    const knownApp = apps.find((a) => a.appId === app.appId)
    if (knownApp) {
      log(`App ${knownApp.contractName} deployed at ${app.appProxy}`)
    } else {
      log(`Unknown AppId ${app.appId} deployed at ${app.appProxy}`)
    }
  })
  log('=========')

  return {
    dao: daoEvent.args.dao,
    token: tokenEvent.args.token
  }
}

module.exports = runOrWrapScript(deploy, module)
