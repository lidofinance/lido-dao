const chalk = require('chalk')
const hre = require('hardhat')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER || ''

async function deployWithdrawalQueueProxyContract({ web3, artifacts }) {
    const netId = await web3.eth.net.getId()
    const network = hre.network.name

    logWideSplitter()
    log(`Network ID: ${chalk.yellow(netId)}`)
    log(`Network name: ${chalk.yellow(network)}`)

    const state = readNetworkState(network, netId)
    const deployer = DEPLOYER || state.multisigAddress

    console.log('deployer', deployer)

    const lidoAgentAddress = state['app:aragon-agent'].proxyAddress
    console.log('Lido DAO Agent', lidoAgentAddress)

    const withdrawalQueueEarlyCommitmentAddress = state['withdrawalQueueEarlyCommitmentContractAddress']
    console.log('WithdrawalQueueEarlyCommitment', withdrawalQueueEarlyCommitmentAddress)

    const withdrawalQueueProxyContractResults = await deployWithdrawalQueueProxy({
        artifacts,
        lidoAgentAddress,
        withdrawalQueueEarlyCommitmentAddress,
        deployer,
    })

    logSplitter()
    persistNetworkState(network, netId, state, withdrawalQueueProxyContractResults)
}

async function deployWithdrawalQueueProxy({ artifacts, lidoAgentAddress, withdrawalQueueEarlyCommitmentAddress, deployer }) {
    const withdrawalQueueProxyContract = await deploy(
        'OssifiableProxy', artifacts, withArgs(withdrawalQueueEarlyCommitmentAddress, lidoAgentAddress, "0x", { from: deployer })
    )
    return { withdrawalQueueProxyContract }
}

module.exports = runOrWrapScript(deployWithdrawalQueueProxyContract, module)
