const { hash: namehash } = require('eth-ens-namehash')
const keccak256 = require('js-sha3').keccak_256
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')
const logDeploy = require('@aragon/os/scripts/helpers/deploy-logger')

const {
  ANY_ENTITY,
  NO_MANAGER,
  ZERO_ADDRESS,
  addressesEqual,
  resolveAddressOrEnsDomain,
  getAclAddress,
  encodeInitPayload,
  getAppProxyAddressFromReceipt,
  getAppBase,
  defaultAPMName,
  startLocalDaemon,
  getBinaryPath,
  getDefaultRepoPath,
  isLocalDaemonRunning,
  getApmRepo,
} = require('@aragon/toolkit')

const globalArtifacts = this.artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 // Not injected unless called directly via truffle

const errorOut = message => {
  console.error(message)
  throw new Error(message)
}

const dePoolTemplateName = 'depool-template'
const dePoolTld = `depoolspm.eth`

const ONE_DAY = 60 * 60 * 24
const ONE_WEEK = ONE_DAY * 7
const THIRTY_DAYS = ONE_DAY * 30

const defaultOwner = process.env.OWNER
const defaultENSAddress = process.env.ENS || '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'
const defaultDepositContractAddress = process.env.DEPOSIT_CONTRACT || '0x5f4e510503d83bd1a5436bdae2923489da0be454'

module.exports = async (truffleExecCallback, {
  artifacts = globalArtifacts,
  web3 = globalWeb3,
  ensAddress = defaultENSAddress,
  owner = defaultOwner,
  depositContractAddress = defaultDepositContractAddress,
  verbose = true,
} = {}) => {
  const log = (...args) => {
    if (verbose) {
      console.log(...args)
    }
  }

  if (!web3) errorOut('Missing "web3" object. This script must be run with a "web3" object globally defined, for example through "truffle exec".')
  if (!artifacts) errorOut('Missing "artifacts" object. This script must be run with an "artifacts" object globally defined, for example through "truffle exec".')
  if (!ensAddress) errorOut('Missing ENS address. Please specify one using ENS env var')
  if (!depositContractAddress) errorOut('Missing Deposit Contract address. Please specify one using DAO_FACTORY env var')

  const [_owner, holder1, holder2, holder3, holder4, holder5] = await getAccounts(web3)
  if (!owner) {
    owner = _owner
    log('OWNER env variable not found, setting owner to the provider\'s first account')
  }
  log('Owner:', owner)

  try {
    const Repo = artifacts.require('Repo')
    const PublicResolver = artifacts.require('PublicResolver')
    const ENS = artifacts.require('ENS')
    const DePoolTemplate = artifacts.require('DePoolTemplate')

    const ens = await ENS.at(ensAddress)
    log(`Using provided ENS: ${ensAddress}`)

    log('=========')

    const tmplNameHash = namehash(`${dePoolTemplateName}.${dePoolTld}`)
    const resolverAddress = await ens.resolver(tmplNameHash)
    const resolver = await PublicResolver.at(resolverAddress)
    const repoAddress = await resolver.addr(tmplNameHash)
    const repo = await Repo.at(repoAddress)
    // log('id', await repo.appId())
    const latestRepo = await repo.getLatest()
    const tmplAddress = latestRepo[1]

    const template = await DePoolTemplate.at(tmplAddress)
    console.log(`Using DePool template ${dePoolTemplateName}.${dePoolTld} at:`, template.address)

    //TODO move holders to .env
    const HOLDERS = [holder1, holder2, holder3, holder4, holder5]
    const STAKES = HOLDERS.map(() => '100000000000000000000') //100e18
    const TOKEN_NAME = 'DePool DAO Token'
    const TOKEN_SYMBOL = 'DPD'

    const VOTE_DURATION = ONE_WEEK
    const SUPPORT_REQUIRED = '500000000000000000' //50e16
    const MIN_ACCEPTANCE_QUORUM = '50000000000000000' //5e16
    const VOTING_SETTINGS = [SUPPORT_REQUIRED, MIN_ACCEPTANCE_QUORUM, VOTE_DURATION]

    // const newInstanceTx = template.contract.methods.newDAO(TOKEN_NAME, TOKEN_SYMBOL, HOLDERS, STAKES, VOTING_SETTINGS, depositContractAddress)
    // const estimatedGas = await newInstanceTx.estimateGas()
    // log(estimatedGas)

    console.log('Deploying DePool DAO ...')
    const receipt = await template.newDAO(TOKEN_NAME, TOKEN_SYMBOL, HOLDERS, STAKES, VOTING_SETTINGS, depositContractAddress, { from: owner })
    const tokenEvent = receipt.logs.find(l => l.event === 'DeployToken')
    const daoEvent = receipt.logs.find(l => l.event === 'DeployDao')

    log('# DAO:')
    log('Address:', daoEvent.args.dao)
    log('Token:', tokenEvent.args.token)
    log('=========')

    if (typeof truffleExecCallback === 'function') {
      // Called directly via `truffle exec`
      truffleExecCallback()
    } else {
      return {
        dao: daoEvent.args.dao,
        token: tokenEvent.args.token,
      }
    }
  } catch (e) {
    if (typeof truffleExecCallback === 'function') {
      truffleExecCallback(e)
    } else {
      throw e
    }
  }
}
