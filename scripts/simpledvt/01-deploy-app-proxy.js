const { network } = require('hardhat')
const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl } = require('../helpers/log')
const { getDeployer, readStateAppAddress, _checkEq } = require('./helpers')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState,
} = require('../helpers/persisted-network-state')

const { hash: namehash } = require('eth-ens-namehash')
const { ZERO_ADDRESS } = require('../../test/helpers/utils')

const APP_TRG = process.env.APP_TRG || 'simple-dvt'
const DEPLOYER = process.env.DEPLOYER || ''

const REQUIRED_NET_STATE = ['lidoApm', 'lidoApmEnsName']

async function deployEmptyProxy({ web3, artifacts, trgAppName = APP_TRG }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const deployer = await getDeployer(web3, DEPLOYER)
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)

  const kernelAddress = state.daoAddress || readStateAppAddress(state, `aragon-kernel`)
  if (!kernelAddress) {
    throw new Error(`No Aragon kernel (DAO address) found!`)
  }

  log.splitter()
  log(`DAO:`, yl(kernelAddress))
  log(`Target App:`, yl(trgAppName))
  log(`Target App ENS:`, yl(trgAppFullName))
  log(`Target App ID:`, yl(trgAppId))
  log.splitter()

  let trgProxyAddress

  if (state[`app:${trgAppName}`]) {
    trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`)
  }

  if (!trgProxyAddress || (await web3.eth.getCode(trgProxyAddress)) === '0x') {
    const kernel = await artifacts.require('Kernel').at(kernelAddress)
    const tx = await log.tx(
      `Deploying proxy for ${trgAppName}`,
      kernel.newAppProxy(kernelAddress, trgAppId, { from: deployer })
    )
    // Find the deployed proxy address in the tx logs.
    const e = tx.logs.find((l) => l.event === 'NewAppProxy')
    trgProxyAddress = e.args.proxy

    // upd deployed state
    persistNetworkState(network.name, netId, state, {
      [`app:${trgAppName}`]: {
        aragonApp: {
          name: trgAppName,
          fullName: trgAppFullName,
          id: trgAppId,
        },
        proxy: {
          address: trgProxyAddress,
          contract: '@aragon/os/contracts/apps/AppProxyUpgradeable.sol',
          constructorArgs: [kernelAddress, trgAppId, '0x'],
        },
      },
    })
  }

  log(`Target app proxy deployed at`, yl(trgProxyAddress))

  log.splitter()
  log('Checking deployed proxy...')

  const proxy = await artifacts.require('AppProxyUpgradeable').at(trgProxyAddress)

  _checkEq(await proxy.kernel(), kernelAddress, 'App proxy kernel address matches Lido DAO')
  _checkEq(await proxy.appId(), trgAppId, 'App proxy AppId matches SimpleDVT')
  _checkEq(await proxy.implementation(), ZERO_ADDRESS, 'App proxy has ZERO_ADDRESS implementations')
}

module.exports = runOrWrapScript(deployEmptyProxy, module)
