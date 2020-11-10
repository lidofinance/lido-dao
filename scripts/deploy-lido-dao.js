const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const {log, logSplitter, logWideSplitter, logHeader, logTx, logDeploy} = require('./helpers/log')
const {deploy, useOrDeploy} = require('./helpers/deploy')
const {readNetworkState, persistNetworkState, updateNetworkState} = require('./helpers/persisted-network-state')

const {deployAPM, resolveLatestVersion} = require('./components/apm')
const {assignENSName, getENSNodeOwner, resolveEnsAddress} = require('./components/ens')

const DAO_NAME = process.env.DAO_NAME || 'lido-dao'
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'

const DEFAULT_DAO_SETTINGS = {
  holders: [ /* acct1, acct2, acct3 */ ],
  stakes: ['100000000000000000000', '100000000000000000000', '100000000000000000000'], // 100e18
  tokenName: 'Lido DAO Token',
  tokenSymbol: 'LDO',
  voteDuration: 60 * 3, // 3 minutes
  votingSupportRequired: '500000000000000000', // 50e16 basis points === 50%
  votingMinAcceptanceQuorum: '50000000000000000', // 5e16 basis points === 5%
  depositIterationLimit: 16
}

const APPS_DIR_PATH = path.resolve(__dirname, '..', 'apps')
const LIDO_APP_NAMES = fs.readdirSync(APPS_DIR_PATH)

const REQUIRED_NET_STATE = [
  'owner',
  'ensAddress',
  'aragonIDEnsNodeName',
  'lidoEnsNodeName',
  'lidoApmRegistryAddress',
  'daoTemplateNode'
]

async function deployDao({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE,
  defaultDaoName = DAO_NAME,
  defaultDaoSettings = DEFAULT_DAO_SETTINGS
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(networkStateFile, netId)

  const missingState = REQUIRED_NET_STATE.filter(key => !state[key])
  if (missingState.length) {
    const missingDesc = missingState.join(', ')
    throw new Error(`missing following fields from network state file, make sure you've run previous deployment steps: ${missingDesc}`)
  }

  const missingApps = LIDO_APP_NAMES.filter(name => !state[`lido_app_${name}_id`])
  if (missingApps.length) {
    const missingDesc = missingApps.join(', ')
    throw new Error(`missing following apps from network state file, make sure you've deployed them: ${missingDesc}`)
  }

  log(`Owner: ${chalk.yellow(state.owner)}`)

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log(`Using ENS: ${chalk.yellow(ens.address)}`)

  if (!state.daoName) {
    state.daoName = defaultDaoName
    log(`Using default DAO name: ${state.daoName}`)
  }

  const isDevNet = netId <= 1000

  if (!state.daoInitialSettings) {
    if (isDevNet) {
      throw new Error(`please specify initial DAO settings in state file ${networkStateFile}`)
    }
    const accounts = (await web3.eth.getAccounts()).slice(0, 3)
    state.daoInitialSettings = {
      ...defaultDaoSettings,
      holders: accounts,
      stakes: defaultDaoSettings.stakes.slice(0, accounts.length)
    }
    log(`Using default DAO settings`)
  }

  if (!state.depositContractAddress && isDevNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }

  logHeader(`DepositContract`)
  const depositContractResults = await useOrDeployDepositContract({
    artifacts,
    owner: state.owner,
    depositContractAddress: state.depositContractAddress
  })
  updateNetworkState(state, depositContractResults)

  logHeader(`The DAO`)

  const aragonApps = {}
  const lidoApps = {}

  Object.keys(state).forEach(key => {
    if (key.substr(0, 11) === 'aragon_app_') {
      const appName = key.substring(11, key.lastIndexOf('_'))
      aragonApps[appName] = aragonApps[appName] || {
        fullName: state[`aragon_app_${appName}_name`],
        ensNode: state[`aragon_app_${appName}_id`],
      }
    } else if (key.substr(0, 9) === 'lido_app_') {
      const appName = key.substring(9, key.lastIndexOf('_'))
      lidoApps[appName] = lidoApps[appName] || {
        fullName: state[`lido_app_${appName}_name`],
        ensNode: state[`lido_app_${appName}_id`],
      }
    }
  })

  log(`Checking app repos...`)
  for (const [name, {fullName, ensNode}] of Object.entries(lidoApps)) {
    const repoAddress = await resolveEnsAddress(artifacts, ens, ensNode)
    if (repoAddress) {
      log(`Found repo for app ${name} (${fullName}): ${chalk.yellow(repoAddress)}`)
    } else {
      throw new Error(`failed to resolve repo for app ${name} (${fullName})`)
    }
  }

  const daoResults = await deployDAO({
    artifacts,
    ens,
    knownApps: {...aragonApps, ...lidoApps},
    owner: state.owner,
    lidoApmRegistryAddress: state.lidoApmRegistryAddress,
    depositContractAddress: state.depositContractAddress,
    aragonIDEnsNodeName: state.aragonIDEnsNodeName,
    lidoEnsNodeName: state.lidoEnsNodeName,
    daoTemplateNode: state.daoTemplateNode,
    daoName: state.daoName,
    daoInitialSettings: state.daoInitialSettings,
    daoAddress: state.daoAddress
  })
  updateNetworkState(state, daoResults)

  logWideSplitter()
  persistNetworkState(networkStateFile, netId, state)
}

async function useOrDeployDepositContract({artifacts, owner, depositContractAddress}) {
  if (depositContractAddress) {
    log(`Using DepositContract at: ${chalk.yellow(depositContractAddress)}`)
    const depositContract = await artifacts.require('IDepositContract').at(depositContractAddress)
    return {depositContract}
  }
  log(chalk.red(`WARN deploying a new instance of DepositContract`))
  const depositContract = await deploy(
    'DepositContract',
    artifacts,
    DepositContract => DepositContract.new({from: owner})
  )
  return {depositContract}
}

async function deployDAO({
  artifacts,
  owner,
  ens,
  lidoApmRegistryAddress,
  daoTemplateNode,
  aragonIDEnsNodeName,
  lidoEnsNodeName,
  daoName,
  daoInitialSettings,
  depositContractAddress,
  knownApps,
  daoAddress
}) {
  if (daoAddress) {
    log(`Using DAO at: ${chalk.yellow(daoAddress)}`)
    const dao = await artifacts.require('Kernel').at(daoAddress)
    return {dao}
  }

  const templateLatestVersion = await resolveLatestVersion(daoTemplateNode, ens, artifacts)
  if (!templateLatestVersion) {
    throw new Error(`DAO template is not published to APM`)
  }

  const {contractAddress: daoTemplateAddress} = templateLatestVersion
  log(`Using registered DAO template: ${chalk.yellow(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)

  log(`Using DepositContract at: ${chalk.yellow(depositContractAddress)}`)

  const daoEnsName = `${daoName}.${aragonIDEnsNodeName}`

  log(`Using DAO name: ${chalk.yellow(daoName)}`)
  log(`Using ENS name: ${chalk.yellow(daoEnsName)}`)
  log(`Using DAO initial settings:`, daoInitialSettings)

  const votingSettings = [
    daoInitialSettings.votingSupportRequired,
    daoInitialSettings.votingMinAcceptanceQuorum,
    daoInitialSettings.voteDuration
  ]

  logSplitter()

  const deployResult = await logTx(
    `Deploying DAO from template`,
    template.newDAO(
      daoName,
      daoInitialSettings.tokenName,
      daoInitialSettings.tokenSymbol,
      daoInitialSettings.holders,
      daoInitialSettings.stakes,
      votingSettings,
      depositContractAddress,
      daoInitialSettings.depositIterationLimit,
      {from: owner, gas: 11500000}
    )
  )

  logSplitter()

  await logTx(`Finalizing DAO`, template.finalizeDAO({from: owner}))

  logSplitter()

  const tokenEvent = deployResult.logs.find((l) => l.event === 'DeployToken')
  const daoEvent = deployResult.logs.find((l) => l.event === 'DeployDao')
  const installedApps = deployResult.logs.filter((l) => l.event === 'InstalledApp').map((l) => l.args)

  const dao = await artifacts.require('Kernel').at(daoEvent.args.dao)
  const token = await artifacts.require('ERC20').at(tokenEvent.args.token)

  log(`Deployed DAO: ${chalk.yellow(dao.address)}`)
  log(`Deployed DAO share token ${daoInitialSettings.tokenSymbol}: ${chalk.yellow(token.address)}`)

  logSplitter()

  const knownAppsByEnsNode = Object.fromEntries(
    Object.entries(knownApps).map(
      ([appName, {ensNode, fullName}]) => [ensNode, {name: appName, fullName}]
    )
  )

  const appProxies = {}

  for (const app of installedApps) {
    const knownApp = knownAppsByEnsNode[app.appId]
    if (knownApp) {
      log(`App ${knownApp.fullName}: ${chalk.yellow(app.appProxy)}`)
      appProxies[knownApp.fullName] = app.appProxy
    } else {
      log(`Unknown app ${app.appId}: ${chalk.yellow(app.appProxy)}`)
      appProxies[app.appId] = app.appProxy
    }
  }

  return {dao, token, appProxies}
}

module.exports = runOrWrapScript(deployDao, module)
