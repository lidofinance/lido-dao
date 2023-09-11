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
const { deployContract, deployImplementation } = require('../helpers/deploy')

// this is needed for the next two `require`s to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')

const { generateArtifacts } = require('@aragon/buidler-aragon/dist/src/utils/artifact/generateArtifacts')
const { uploadDirToIpfs } = require('@aragon/buidler-aragon/dist/src/utils/ipfs')
const { toContentUri } = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const { APP_NAMES } = require('../constants')
const VALID_APP_NAMES = Object.entries(APP_NAMES).map((e) => e[1])

const APPS = process.env.APPS || '*'
const APPS_DIR_PATH = process.env.APPS_DIR_PATH || path.resolve(__dirname, '..', '..', 'apps')


const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE


const INITIAL_APP_VERSION = [1, 0, 0]

const REQUIRED_NET_STATE = [
  'aragonApmRegistryAddress',
  'multisigAddress',
]



async function deployAragonStdApps({ web3, artifacts, }) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const apm = await artifacts.require("APMRegistry").at(state.aragonApmRegistryAddress)

  const appName = "Agent"
  const constructorArgs = []
  const deployer = state["multisigAddress"]
  // const agentImpl = deployApp({artifacts, appName, constructorArgs, deployer})

  // state['app:aragon-agent']["implementation"]["address"]
  await deployImplementation("app:aragon-agent", "Agent", deployer)
  await deployImplementation("app:aragon-finance", "Finance", deployer)
  await deployImplementation("app:aragon-token-manager", "TokenManager", deployer)
  await deployImplementation("app:aragon-voting", "Voting", deployer)
  // await deployContract("app:aragon-agent", constructorArgs, deployer)
  // await deployContract("app:aragon-finance", constructorArgs, deployer)
  // await deployContract("app:aragon-token-manager", constructorArgs, deployer)
  // await deployContract("app:aragon-voting", constructorArgs, deployer)

  // await apm.newRepoWithVersion(

  // {})

  // TODO: apm.publishVersion
  // don't forget .wait
}

async function deployApp({ artifacts, appName, constructorArgs, deployer }) {
  const appContract = await deployContract(appName, constructorArgs, deployer)
  return appContract
}


async function readArappJSON(
  appRoot,
  netName,
  networkStateFile = NETWORK_STATE_FILE,
) {
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

module.exports = runOrWrapScript(deployAragonStdApps, module)
