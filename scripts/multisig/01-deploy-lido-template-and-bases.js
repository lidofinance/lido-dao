const chalk = require('chalk')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'daoFactoryAddress',
  'miniMeTokenFactoryAddress',
  'aragonIDAddress',
  'apmRegistryFactoryAddress',
  'multisigAddress'
]

async function deployTemplate({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  const daoTemplateConstructorArgs = [
    state.multisigAddress,
    state.daoFactoryAddress,
    state.ensAddress,
    state.miniMeTokenFactoryAddress,
    state.aragonIDAddress,
    state.apmRegistryFactoryAddress
  ]

  log.splitter()

  await saveDeployTx('LidoTemplate', 'tx-01-1-deploy-template.json', {
    arguments: daoTemplateConstructorArgs,
    from: state.multisigAddress
  })
  await saveDeployTx('Lido', 'tx-01-2-deploy-lido-base.json', {
    from: state.multisigAddress
  })
  await saveDeployTx('LidoOracle', 'tx-01-3-deploy-oracle-base.json', {
    from: state.multisigAddress
  })
  await saveDeployTx('NodeOperatorsRegistry', 'tx-01-4-deploy-nops-base.json', {
    from: state.multisigAddress
  })

  persistNetworkState(network.name, netId, state, {
    daoTemplateConstructorArgs,
    daoTemplateDeployTx: '',
    lidoBaseDeployTx: '',
    oracleBaseDeployTx: '',
    nodeOperatorsRegistryBaseDeployTx: ''
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all contract creation transactions`))
  log(gr(`that you can find in the files listed above. You may use a multisig address`))
  log(gr(`if it supports deploying new contract instances.`))
  log.splitter()

}

module.exports = runOrWrapScript(deployTemplate, module)
