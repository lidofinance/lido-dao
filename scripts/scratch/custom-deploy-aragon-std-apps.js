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
const { readJSON } = require('../helpers/fs')
const { deployContract, deployImplementation } = require('../helpers/deploy')

// this is needed for the next two `require`s to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')


const REQUIRED_NET_STATE = [
  'multisigAddress',
]


async function deployAragonStdApps({ web3, artifacts, }) {
  const netId = await web3.eth.net.getId()
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const deployer = state["multisigAddress"]
  await deployImplementation("app:aragon-agent", "Agent", deployer)
  await deployImplementation("app:aragon-finance", "Finance", deployer)
  await deployImplementation("app:aragon-token-manager", "TokenManager", deployer)
  await deployImplementation("app:aragon-voting", "Voting", deployer)
}

async function deployApp({ artifacts, appName, constructorArgs, deployer }) {
  const appContract = await deployContract(appName, constructorArgs, deployer)
  return appContract
}

module.exports = runOrWrapScript(deployAragonStdApps, module)
