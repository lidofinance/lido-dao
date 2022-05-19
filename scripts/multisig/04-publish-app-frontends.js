const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const { assert } = require('chai')
const { hash: namehash } = require('eth-ens-namehash')
const buidlerTaskNames = require('@nomiclabs/buidler/builtin-tasks/task-names')
const hardhatTaskNames = require('hardhat/builtin-tasks/task-names')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, logHeader, logTx } = require('../helpers/log')
const { useOrGetDeployed } = require('../helpers/deploy')
const { readNetworkState, persistNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { exec, execLive } = require('../helpers/exec')
const { readJSON } = require('../helpers/fs')

// this is needed for the next two `require`s to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')

const { generateArtifacts } = require('@aragon/buidler-aragon/dist/src/utils/artifact/generateArtifacts')
const { uploadDirToIpfs } = require('@aragon/buidler-aragon/dist/src/utils/ipfs')
const { toContentUri } = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const { APP_NAMES } = require('./constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const REQUIRED_NET_STATE = ['lidoApmEnsName', 'ipfsAPI']

const APPS = process.env.APPS || '*'
const APPS_DIR_PATH = process.env.APPS_DIR_PATH || path.resolve(__dirname, '..', '..', 'apps')

async function publishAppFrontends({ web3, artifacts, appsDirPath = APPS_DIR_PATH, appDirs = APPS }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  appsDirPath = path.resolve(appsDirPath)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  if (appDirs && appDirs !== '*') {
    appDirs = appDirs.split(',')
  } else {
    appDirs = fs.readdirSync(appsDirPath)
  }

  const cwd = process.cwd()

  for (const appDir of appDirs) {
    let app
    try {
      app = await publishAppFrotnend(appDir, appsDirPath, state.ipfsAPI, state.lidoApmEnsName)
    } finally {
      process.chdir(cwd)
    }
    persistNetworkState(network.name, netId, state, {
      [`app:${app.name}`]: {
        ...state[`app:${app.name}`],
        ...app
      }
    })
  }
}

async function publishAppFrotnend(appDir, appsDirPath, ipfsAPI, lidoApmEnsName) {
  logHeader(`Publishing frontend of the app '${appDir}'`)

  const appRootPath = path.resolve(appsDirPath, appDir)
  const { appFullName, contractPath } = await readArappJSON(appRootPath, network.name)

  log(`App full name: ${chalk.yellow(appFullName)}`)

  if (!appFullName.endsWith('.' + lidoApmEnsName)) {
    throw new Error(`app full name is not a subdomain of the Lido APM ENS domain ${lidoApmEnsName}`)
  }

  const appName = appFullName.substring(0, appFullName.indexOf('.'))
  log(`App name: ${chalk.yellow(appName)}`)

  if (VALID_APP_NAMES.indexOf(appName) === -1) {
    throw new Error(`app name is not recognized; valid app names are: ${VALID_APP_NAMES.join(', ')}`)
  }

  const appId = namehash(appFullName)
  log(`App ID: ${chalk.yellow(appId)}`)

  logSplitter()

  log('Removing output directory...')
  const distPath = path.join(appRootPath, 'dist')
  await exec(`rm -rf ${distPath}`)

  await execLive('yarn', {
    args: ['build'],
    cwd: path.join(appRootPath, 'app')
  })

  logSplitter()
  log('Generating artifacts...')

  process.chdir(appRootPath)

  const wrappedRun = async (taskName, ...args) => {
    if (taskName !== buidlerTaskNames.TASK_FLATTEN_GET_FLATTENED_SOURCE) {
      return await run(taskName)
    }
    // buidler-aragon tries to get flattened source code of all contracts and fails to
    // parce Solidity syntax newer than 0.4 (which we have in non-Aragon contracts), so
    // here we're flattening only the app's dependency graph instead
    return await run(hardhatTaskNames.TASK_FLATTEN_GET_FLATTENED_SOURCE, {
      files: [contractPath]
    })
  }

  const bre = { artifacts, network, run: wrappedRun }
  await generateArtifacts(distPath, bre)

  logSplitter()
  log('Uploading to IPFS...')

  const rootCid = await uploadDirToIpfs({ dirPath: distPath, ipfsApiUrl: ipfsAPI })
  log(`Content root CID: ${chalk.yellow(rootCid)}`)

  return {
    fullName: appFullName,
    name: appName,
    id: appId,
    ipfsCid: rootCid,
    contentURI: toContentUri('ipfs', rootCid)
  }
}

async function readArappJSON(appRoot, netName) {
  const arappJSON = await readJSON(path.join(appRoot, 'arapp.json'))
  const appFullName = getAppName(arappJSON, netName)
  const contractPath = path.resolve(appRoot, arappJSON.path)
  return { appFullName, contractPath }
}

function getAppName(arappJSON, netName) {
  const { environments } = arappJSON
  if (!environments) {
    return null
  }
  if (environments[netName]) {
    // NOTE: assuming that Aragon environment is named after the network
    return environments[netName].appName
  }
  return (environments.default || {}).appName || null
}

module.exports = runOrWrapScript(publishAppFrontends, module)
