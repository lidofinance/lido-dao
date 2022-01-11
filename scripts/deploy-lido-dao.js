const BN = require('bn.js')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')
const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx, logDeploy, yl } = require('./helpers/log')
const { deploy, useOrDeploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState, updateNetworkState } = require('./helpers/persisted-network-state')

const { resolveLatestVersion } = require('./components/apm')

const DAO_NAME = process.env.DAO_NAME || 'lido-dao'
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'
const MAX_HOLDERS_IN_ONE_TX = 30

const DEFAULT_DAO_SETTINGS = {
  holders: [
    /* acct1, acct2, acct3 */
  ],
  stakes: ['100000000000000000000', '100000000000000000000', '100000000000000000000'], // 100e18
  tokenName: 'Lido DAO Token',
  tokenSymbol: 'LDO',
  // voteDuration: 60 * 3, // 3 minutes
  // votingSupportRequired: '500000000000000000', // 50e16 basis points === 50%
  // votingMinAcceptanceQuorum: '50000000000000000', // 5e16 basis points === 5%
  voting: {
    minSupportRequired: '500000000000000000', // 50e16 basis points === 50%
    minAcceptanceQuorum: '50000000000000000', // 5e16 basis points === 5%
    voteDuration: 60 * 3 // 3 minutes
  },
  beaconSpec: {
    epochsPerFrame: 225,
    slotsPerEpoch: 32,
    secondsPerSlot: 12,
    genesisTime: 1606824000
  },
  fee: {
    totalPercent: 10,
    treasuryPercent: 0,
    insurancePercent: 50,
    nodeOperatorsPercent: 50
  }
}

const APPS_DIR_PATH = path.resolve(__dirname, '..', 'apps')
const LIDO_APP_NAMES = fs.readdirSync(APPS_DIR_PATH)

const REQUIRED_NET_STATE = [
  'owner',
  'ensAddress',
  'aragonIDEnsNodeName',
  'lidoEnsNodeName',
  'lidoApmAddress',
  'daoTemplateNode',
  'vestingParams',
  'daoInitialSettings'
]

async function deployDao({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE,
  defaultDaoAragonId = DAO_NAME,
  defaultDaoSettings = DEFAULT_DAO_SETTINGS
}) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readNetworkState(network.name, netId)

  const missingState = REQUIRED_NET_STATE.filter((key) => !state[key])
  if (missingState.length) {
    const missingDesc = missingState.join(', ')
    throw new Error(`missing following fields from network state file, make sure you've run previous deployment steps: ${missingDesc}`)
  }

  const missingApps = LIDO_APP_NAMES.filter((name) => !state[`app:${name}`])
  if (missingApps.length) {
    const missingDesc = missingApps.join(', ')
    throw new Error(`missing following apps from network state file, make sure you've deployed them: ${missingDesc}`)
  }

  log(`Owner: ${yl(state.owner)}`)

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log(`Using ENS: ${yl(ens.address)}`)

  if (!state.daoAragonId) {
    state.daoAragonId = defaultDaoAragonId
    log(`Using default DAO name: ${state.daoAragonId}`)
  }

  const isPublicNet = netId <= 1000

  if (state.daoInitialSettings) {
    state.daoInitialSettings = {
      ...defaultDaoSettings,
      ...state.daoInitialSettings
    }
  } else {
    if (isPublicNet) {
      throw new Error(`please specify initial DAO settings in state file ${networkStateFile}`)
    }
    const accounts = (await web3.eth.getAccounts()).slice(0, 3)
    state.daoInitialSettings = {
      ...defaultDaoSettings
    }
    log(`Using default DAO settings`)
  }

  if (!state.depositContractAddress && !state.daoInitialSettings.beaconSpec.depositContractAddress && isPublicNet) {
    throw new Error(`please specify deposit contract address in state file ${networkStateFile}`)
  }

  logHeader(`DepositContract`)
  const depositContractResults = await useOrDeployDepositContract({
    artifacts,
    owner: state.owner,
    depositContractAddress: state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress
  })
  updateNetworkState(state, depositContractResults)
  persistNetworkState(network.name, netId, state)

  logHeader(`The DAO`)

  const apps = {}

  Object.keys(state).forEach((key) => {
    if (key.match('app:.*')) {
      const app = state[key]
      apps[`app:${app.name}`] = apps[app.name] || {
        name: app.name,
        fullName: app.fullName,
        id: app.id
      }
    }
  })

  log(`Checking app impls...`)
  for (const [appKey, { name, fullName, id }] of Object.entries(apps)) {
    const latest = await resolveLatestVersion(id, ens, artifacts)
    if (latest) {
      const vDesc = latest.semanticVersion.map((x) => `${x}`).join('.')
      log(`Found an impl v${vDesc} for app '${name}' (${fullName}): ${yl(latest.contractAddress)}`)

      if (!apps[`app:${name}`].baseAddress) {
        apps[`app:${name}`].baseAddress = latest.contractAddress
      }
    } else {
      throw new Error(`failed to resolve an impl for app '${name}' (${fullName})`)
    }
  }
  updateNetworkState(state, apps)
  persistNetworkState(network.name, netId, state)
  logSplitter()

  const daoResults = await deployDAO({
    artifacts,
    ens,
    knownApps: { ...apps },
    owner: state.owner,
    lidoApmAddress: state.lidoApmAddress,
    depositContractAddress: state.depositContractAddress || state.daoInitialSettings.beaconSpec.depositContractAddress,
    aragonIDEnsNodeName: state.aragonIDEnsNodeName,
    lidoEnsNodeName: state.lidoEnsNodeName,
    daoTemplateNode: state.daoTemplateNode,
    daoAragonId: state.daoAragonId,
    daoInitialSettings: state.daoInitialSettings,
    daoAddress: state.daoAddress,
    vestingParams: state.vestingParams
  })
  updateNetworkState(state, daoResults)
  persistNetworkState(network.name, netId, state)

  log(`Try to open aragon: http://localhost:3000/#/${state.daoAddress}`)

  logWideSplitter()
}

async function useOrDeployDepositContract({ artifacts, owner, depositContractAddress }) {
  if (depositContractAddress) {
    log(`Using DepositContract at: ${yl(depositContractAddress)}`)
    const depositContract = await artifacts
      .require('contracts/0.4.24/interfaces/IDepositContract.sol:IDepositContract')
      .at(depositContractAddress)
    return { depositContract }
  }
  log(chalk.red(`WARN deploying a new instance of DepositContract`))
  const depositContract = await deploy('DepositContract', artifacts, withArgs({ from: owner }))
  return { depositContract }
}

async function deployDAO({
  artifacts,
  owner,
  ens,
  lidoApmAddress,
  daoTemplateNode,
  aragonIDEnsNodeName,
  lidoEnsNodeName,
  daoAragonId,
  daoInitialSettings,
  depositContractAddress,
  knownApps,
  daoAddress,
  vestingParams
}) {
  if (daoAddress) {
    log(`Using DAO at: ${yl(daoAddress)}`)
    const dao = await artifacts.require('Kernel').at(daoAddress)
    return { dao }
  }

  const templateLatestVersion = await resolveLatestVersion(daoTemplateNode, ens, artifacts)
  if (!templateLatestVersion) {
    throw new Error(`DAO template is not published to APM`)
  }

  const { contractAddress: daoTemplateAddress } = templateLatestVersion
  log(`Using registered DAO template: ${yl(daoTemplateAddress)}`)
  const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)

  log(`Using DepositContract at: ${yl(depositContractAddress)}`)

  const daoEnsName = `${daoAragonId}.${aragonIDEnsNodeName}`

  log(`Using DAO name: ${yl(daoAragonId)}`)
  log(`Using ENS name: ${yl(daoEnsName)}`)
  log(`Using DAO initial settings:`, daoInitialSettings)

  logSplitter()

  const votingSettings = [
    daoInitialSettings.voting.minSupportRequired,
    daoInitialSettings.voting.minAcceptanceQuorum,
    daoInitialSettings.voting.voteDuration
  ]

  const beaconSpec = [
    daoInitialSettings.beaconSpec.epochsPerFrame,
    daoInitialSettings.beaconSpec.slotsPerEpoch,
    daoInitialSettings.beaconSpec.secondsPerSlot,
    daoInitialSettings.beaconSpec.genesisTime
  ]

  const { fee } = daoInitialSettings
  log(`Using fee initial settings:`)
  log(`  total fee:`, chalk.yellow(`${fee.totalPercent}%`))
  log(`  treasury fee:`, chalk.yellow(`${fee.treasuryPercent}%`))
  log(`  insurance fee:`, chalk.yellow(`${fee.insurancePercent}%`))
  log(`  node operators fee:`, chalk.yellow(`${fee.nodeOperatorsPercent}%`))

  const feeSettings = [fee.totalPercent, fee.treasuryPercent, fee.insurancePercent, fee.nodeOperatorsPercent]

  const newDaoResult = await logTx(
    `Deploying DAO from template`,
    template.newDAO(
      daoAragonId,
      daoInitialSettings.token.name,
      daoInitialSettings.token.symbol,
      votingSettings,
      depositContractAddress,
      beaconSpec,
      feeSettings,
      { from: owner }
    )
  )

  logSplitter()

  const tokenEvent = newDaoResult.logs.find((l) => l.event === 'DeployToken')
  const daoEvent = newDaoResult.logs.find((l) => l.event === 'DeployDao')
  const installedApps = newDaoResult.logs.filter((l) => l.event === 'InstalledApp').map((l) => l.args)

  const dao = await artifacts.require('Kernel').at(daoEvent.args.dao)
  const token = await artifacts.require('@aragon/os/contracts/lib/token/ERC20.sol:ERC20').at(tokenEvent.args.token)

  log(`Deployed DAO: ${yl(dao.address)}`)
  log(`Deployed DAO share token ${daoInitialSettings.tokenSymbol}: ${yl(token.address)}`)

  logSplitter()
  const appProxies = getAppProxies(installedApps, knownApps)

  Object.keys(appProxies).forEach((key) => {
    if (knownApps[key]) {
      knownApps[key].proxyAddress = appProxies[key]
    }
  })
  logSplitter()
  await issueTokens(owner, template, vestingParams)
  logSplitter()

  await logTx(`Finalizing DAO`, template.finalizeDAO(vestingParams.unvestedTokensAmount, { from: owner }))

  return { dao, token, knownApps }
}

function getAppProxies(installedApps, knownApps) {
  const appProxies = {}

  const knownAppsByEnsNode = Object.fromEntries(
    Object.entries(knownApps).map(([appName, { name, id, fullName }]) => [id, { name, fullName }])
  )

  for (const app of installedApps) {
    const knownApp = knownAppsByEnsNode[app.appId]
    if (knownApp) {
      log(`App ${knownApp.fullName}: ${yl(app.appProxy)}`)
      appProxies[`app:${knownApp.name}`] = app.appProxy
    } else {
      log(`Unknown app ${app.appId}: ${yl(app.appProxy)}`)
      appProxies[app.appId] = app.appProxy
    }
  }

  return appProxies
}
async function issueTokens(owner, template, vestingParams) {
  const pairs = Object.entries(vestingParams.holders)
  const holders = pairs.map((p) => p[0])
  const amounts = pairs.map((p) => p[1])

  log(`Using vestingParams settings:`)
  log(`  Start:`, chalk.yellow(formatDate(vestingParams.start)))
  log(`  Cliff:`, chalk.yellow(formatDate(vestingParams.cliff)))
  log(`  End:`, chalk.yellow(formatDate(vestingParams.end)))
  log(`  Revokable:`, chalk.yellow(vestingParams.revokable))

  const totalSupply = bigSum(amounts, vestingParams.unvestedTokensAmount)

  log(`  Total supply:`, chalk.yellow(web3.utils.fromWei(totalSupply.toString(), 'ether')))
  log(`  Unvested tokens amount:`, chalk.yellow(web3.utils.fromWei(vestingParams.unvestedTokensAmount, 'ether')))
  log(`  Token receivers (total ${chalk.yellow(holders.length)}):`)

  holders.forEach((addr, i) => {
    const amount = amounts[i]
    const percentage = +new BN(amount).muln(10000).div(totalSupply) / 100
    log(`    ${addr}: ${chalk.yellow(web3.utils.fromWei(amount, 'ether'))} (${percentage}%)`)
  })

  log.splitter()

  const holdersInOneTx = Math.min(MAX_HOLDERS_IN_ONE_TX, holders.length)
  const totalTxs = Math.ceil(holders.length / holdersInOneTx)

  log(`Total batches:`, chalk.yellow(totalTxs))

  const endTotalSupply = new BN(0)

  for (let i = 0; i < totalTxs; ++i) {
    const startIndex = i * holdersInOneTx
    const iHolders = holders.slice(startIndex, startIndex + holdersInOneTx)
    const iAmounts = amounts.slice(startIndex, startIndex + holdersInOneTx)

    endTotalSupply.iadd(bigSum(iAmounts))
    await logTx(
      `issueTokens (batch ${i + 1})`,
      template.issueTokens(
        iHolders,
        iAmounts,
        vestingParams.start,
        vestingParams.cliff,
        vestingParams.end,
        vestingParams.revokable,
        '0x' + endTotalSupply.toString(16),
        { from: owner }
      )
    )
  }
}

function bigSum(amounts, initialAmount = 0) {
  const sum = new BN(initialAmount)
  amounts.forEach((amount) => {
    sum.iadd(new BN(amount))
  })
  return sum
}

function formatDate(unixTimestamp) {
  return new Date(unixTimestamp * 1000).toUTCString()
}

module.exports = runOrWrapScript(deployDao, module)
