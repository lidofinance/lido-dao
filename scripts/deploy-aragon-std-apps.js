const path = require('path')
const fs = require('fs')
const namehash = require('eth-ens-namehash').hash

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, yl, gr } = require('./helpers/log')
const { readNetworkState, persistNetworkState, updateNetworkState } = require('./helpers/persisted-network-state')
const { readJSON, directoryExists } = require('./helpers/fs')
const { execLive } = require('./helpers/exec')
const { filterObject } = require('./helpers/collections')
const { readAppName } = require('./helpers/aragon')
const { gitCloneRepo } = require('./helpers/git')

const { uploadDirToIpfs } = require('@aragon/buidler-aragon/dist/src/utils/ipfs')
const { toContentUri } = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const APPS = ['agent', 'finance', 'token-manager', 'vault', 'voting']

const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE || 'deployed.json'
const ARAGON_APPS_REPO = process.env.ARAGON_APPS_REPO || 'https://github.com/aragon/aragon-apps.git'
const ARAGON_APPS_REPO_REF = process.env.ARAGON_APPS_REPO_REF || 'master'
const RELEASE_TYPE = 'major'

function writeNetworkStateFile(fileName, state) {
  const data = JSON.stringify(state, null, '  ')
  fs.writeFileSync(fileName, data + '\n', 'utf8')
}

async function deployAragonStdApps({
  web3,
  artifacts,
  networkStateFile = NETWORK_STATE_FILE,
  aragonAppsRepo = ARAGON_APPS_REPO,
  aragonAppsRepoRef = ARAGON_APPS_REPO_REF,
  releaseType = RELEASE_TYPE
}) {
  const hardhatConfig = path.resolve(hardhatArguments.config || 'hardhat.config.js')
  const netId = await web3.eth.net.getId()
  const netName = network.name

  logWideSplitter()
  log(`Network ID: ${yl(netId)}`)

  const netState = readNetworkState(network.name, netId)
  if (!netState.ensAddress) {
    throw new Error(`ensAddress for network ${netId} is missing from network state file ${networkStateFile}`)
  }

  if (!network.config.ensAddress) {
    throw new Error(`ensAddress is not defined for network ${netName} in Hardhat config file ${hardhatConfig}`)
  }

  if (network.config.ensAddress.toLowerCase() !== netState.ensAddress.toLowerCase()) {
    throw new Error(
      `ensAddress for network ${netId} is different in Hardhat config file ${hardhatConfig} ` + `and network state file ${networkStateFile}`
    )
  }

  logHeader(`Checking out aragon-apps repo...`)
  const appsRepoPath = './aragon-apps'
  await gitCloneRepo(appsRepoPath, aragonAppsRepo, aragonAppsRepoRef)

  // prevent Hardhat from passing the config to subprocesses
  const env = filterObject(process.env, (key) => key.substr(0, 8) !== 'HARDHAT_')

  for (const appName of APPS) {
    const app = await publishApp(appName, appsRepoPath, hardhatConfig, env, netName, releaseType, netState)
    persistNetworkState(network.name, netId, netState, {
      [`app:${app.name}`]: {
        ...netState[`app:${app.name}`],
        ...app
      }
    })
  }
}

async function publishApp(appName, appsRepoPath, hardhatConfig, env, netName, releaseType, netState) {
  logHeader(`Publishing new ${releaseType} release of app '${appName}'`)

  let result = {}
  const appRootPath = path.resolve(appsRepoPath, 'apps', appName)
  const appFullName = await readAppName(appRootPath, netName)
  const appId = namehash(appFullName)

  log(`App name: ${yl(appFullName)}`)
  log(`App ID: ${yl(appId)}`)
  logSplitter()

  const appFrontendPath = path.join(appRootPath, 'app')
  const hasFrontend = await directoryExists(appFrontendPath)

  logSplitter(`Change registry app ${appName}`)
  const arappFile = `${appRootPath}/arapp.json`
  const arapp = await readJSON(arappFile)
  if (!arapp.environments[network.name]) {
    arapp.environments[network.name] = { ...arapp.environments.default }
    arapp.environments[network.name].registry = network.config.ensAddress
  }

  logSplitter(`Write state app ${appName}`)
  writeNetworkStateFile(arappFile, arapp)

  if (hasFrontend) {
    logSplitter(`Installing frontend deps for app ${appName}`)
    await execLive('yarn', {
      cwd: appFrontendPath
    })
    logSplitter()

    // logSplitter(`Build app ${appName}`)
    // await execLive('yarn', {
    //   args: ['build'],
    //   cwd: appFrontendPath
    // })
    // logSplitter()
  } else {
    log(`The app has no frontend`)
  }

  const childEnv = {
    ...env,
    STD_APPS_DEPLOY: '1',
    APP_FRONTEND_PATH: `aragon-apps/apps/${appName}/app`,
    APP_FRONTEND_DIST_PATH: `aragon-apps/apps/${appName}/dist`
  }

  // if (hasFrontend) {
  //   const distPath = path.join(appRootPath, 'dist')

  //   // Upload release directory to IPFS
  //   log('Uploading release assets to IPFS...')

  //   const contentHash = await uploadDirToIpfs({
  //     dirPath: distPath,
  //     apiUrl: netState.ipfsAPI
  //   })
  //   log(`Release assets uploaded to IPFS: ${yl(contentHash)}`)

  //   result.ipfsCid = contentHash
  //   result.contentURI = toContentUri('ipfs', contentHash)
  // }

  await execLive('hardhat', {
    args: [
      'publish',
      'major',
      '--config',
      hardhatConfig,
      '--network',
      netName,
      '--skip-validation',
      // '--skip-app-build',
      // workaround: force to read URL from Hardhat config
      '--ipfs-api-url',
      ''
    ],
    cwd: appRootPath,
    env: childEnv
  })

  return {
    ...result,
    fullName: appFullName,
    name: appName,
    id: appId
  }
}

module.exports = runOrWrapScript(deployAragonStdApps, module)
