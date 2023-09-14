const { network } = require('hardhat')
const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const { getDeployer, readStateAppAddress } = require('./helpers')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState2,
} = require('../helpers/persisted-network-state')

const { hash: namehash } = require('eth-ens-namehash')

const APP_TRG = process.env.APP_TRG || 'simple-dvt'
const DEPLOYER = process.env.DEPLOYER || ''

const REQUIRED_NET_STATE = ['lidoApmAddress', 'lidoApmEnsName', 'daoAddress']

async function deployEmptyProxy({ web3, artifacts, trgAppName = APP_TRG }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const deployer = await getDeployer(web3, DEPLOYER)
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)

  log.splitter()
  log(`DAO:`, yl(state.daoAddress))
  log(`Target App:`, yl(trgAppName))
  log(`Target App ENS:`, yl(trgAppFullName))
  log(`Target App ID:`, yl(trgAppId))
  log.splitter()

  let trgProxyAddress

  if (state[`app:${trgAppName}`]) {
    trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`, yl(trgProxyAddress))
  }

  if (trgProxyAddress && (await web3.eth.getCode(trgProxyAddress)) !== '0x') {
    log.error(`Target app proxy is already deployed at`)
    return
  }

  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const tx = await log.tx(
    `Deploying proxy for ${trgAppName}`,
    kernel.newAppProxy(kernel.address, trgAppId, { from: deployer })
  )
  // Find the deployed proxy address in the tx logs.
  const e = tx.logs.find((l) => l.event === 'NewAppProxy')
  trgProxyAddress = e.args.proxy

  // upd deployed state
  persistNetworkState2(network.name, netId, state, {
    [`app:${trgAppName}`]: {
      proxyAddress: trgProxyAddress,
    },
  })

  log(`Target app proxy deployed at`, yl(trgProxyAddress))
  log.splitter()
}

module.exports = runOrWrapScript(deployEmptyProxy, module)
