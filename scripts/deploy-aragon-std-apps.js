const path = require('path')
const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const {log, logSplitter, logWideSplitter, logHeader} = require('./helpers/log')
const {readNetworkState, persistNetworkState, updateNetworkState} = require('./helpers/persisted-network-state')
const {readJSON, directoryExists} = require('./helpers/fs')
const {exec, execLive} = require('./helpers/exec')
const {filterObject} = require('./helpers/collections')
const {readAppName} = require('./helpers/aragon')

const APPS = [
  'agent',
  'finance',
  'token-manager',
  'vault',
  'voting'
]

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'
const ARAGON_APPS_REPO = process.env.ARAGON_APPS_REPO || 'https://github.com/aragon/aragon-apps.git'
const ARAGON_APPS_REPO_REF = process.env.ARAGON_APPS_REPO_REF || 'master'
const RELEASE_TYPE = 'major'

async function deployAragonStdApps({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE,
  aragonAppsRepo = ARAGON_APPS_REPO,
  aragonAppsRepoRef = ARAGON_APPS_REPO_REF,
  releaseType = RELEASE_TYPE
}) {
  const buidlerConfig = path.resolve(buidlerArguments.config || 'buidler.config.js')
  const netId = await web3.eth.net.getId()
  const netName = network.name

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const netState = readNetworkState(networkStateFile, netId)
  if (!netState.ensAddress) {
    throw new Error(`ensAddress for network ${netId} is missing from network state file ${networkStateFile}`)
  }

  if (!network.config.ensAddress) {
    throw new Error(`ensAddress is not defined for network ${netName} in Buidler config file ${buidlerConfig}`)
  }

  if (network.config.ensAddress.toLowerCase() !== network.config.ensAddress.toLowerCase()) {
    throw new Error(
      `ensAddress for network ${netId} is different in Buidler config file ${buidlerConfig} ` +
      `and network state file ${networkStateFile}`
    )
  }

  logHeader(`Checking out aragon-apps repo...`)
  const appsRepoPath = './aragon-apps'
  await gitCloneRepo(appsRepoPath, aragonAppsRepo, aragonAppsRepoRef)

  // prevent Buidler from passing the config to subprocesses
  const env = filterObject(process.env, key => key.substr(0, 8) !== 'BUIDLER_')

  for (let appName of APPS) {
    const results = await publishApp(appName, appsRepoPath, buidlerConfig, env, netName, releaseType)
    updateNetworkState(netState, results)
    persistNetworkState(networkStateFile, netId, netState)
  }
}

async function publishApp(appName, appsRepoPath, buidlerConfig, env, netName, releaseType) {
  logHeader(`Publishing new ${releaseType} release of app '${appName}'`)

  const appRootPath = path.resolve(appsRepoPath, 'apps', appName)
  const appFullName = await readAppName(appRootPath, netName)
  const appId = namehash(appFullName)

  log(`App name: ${chalk.yellow(appFullName)}`)
  log(`App ID: ${chalk.yellow(appId)}`)
  logSplitter()

  const appFrontendPath = path.join(appRootPath, 'app')
  const hasFrontend = await directoryExists(appFrontendPath)

  if (hasFrontend) {
    logSplitter(`Installing frontend deps for app ${appName}`)
    await execLive('yarn', {cwd: appFrontendPath})
    logSplitter()
  } else {
    log(`The app has no frontend`)
  }

  const childEnv = {
    ...env,
    STD_APPS_DEPLOY: '1'
  }

  if (hasFrontend) {
    childEnv.APP_FRONTEND_PATH = appFrontendPath
    childEnv.APP_FRONTEND_DIST_PATH = path.join(appFrontendPath, 'build')
  }

  await execLive('buidler', {
    args: [
      'publish', 'major',
      '--config', buidlerConfig,
      '--network', netName,
      '--skip-validation',
      // workaround: force to read URL from Buidler config
      '--ipfs-api-url', ''
    ],
    cwd: appRootPath,
    env: childEnv
  })

  return {
    [`aragon_app_${appName}_name`]: appFullName,
    [`aragon_app_${appName}_id`]: appId
  }
}

async function gitCloneRepo(targetPath, repoLink, gitRef) {
  const targetAbsPath = path.resolve(targetPath)
  if (!await directoryExists(targetAbsPath)) {
    await execLive('git', {args: ['clone', repoLink, targetAbsPath]})
  }
  await execLive('git', {args: ['reset', '--hard'], cwd: targetAbsPath})
  await execLive('git', {args: ['checkout', gitRef], cwd: targetAbsPath})
}

module.exports = runOrWrapScript(deployAragonStdApps, module)
