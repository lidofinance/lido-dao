const chalk = require('chalk')
const hre = require('hardhat')

const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter } = require('./helpers/log')
const { deploy, withArgs } = require('./helpers/deploy')
const { readNetworkState, persistNetworkState } = require('./helpers/persisted-network-state')

const DEPLOYER = process.env.DEPLOYER || ''

async function deployWithdrawalQueueEarlyCommitmentContract({ web3, artifacts }) {
    const netId = await web3.eth.net.getId()
    const network = hre.network.name

    logWideSplitter()
    log(`Network ID: ${chalk.yellow(netId)}`)
    log(`Network name: ${chalk.yellow(network)}`)

    const state = readNetworkState(network, netId)
    const deployer = DEPLOYER || state.multisigAddress

    console.log('deployer', deployer)

    const stEthAddress = state['app:lido'].proxyAddress
    console.log('stETH address', stEthAddress)
    const wstETHAddress = state['wstethContractAddress']
    console.log('wstETH address', wstETHAddress)

    const withdrawalQueueEarlyCommitmentContractResults = await deployWithdrawalQueueEarlyCommitment({
        artifacts,
        stEthAddress,
        wstETHAddress,
        deployer,
    })

    logSplitter()
    persistNetworkState(network, netId, state, withdrawalQueueEarlyCommitmentContractResults)
}

async function deployWithdrawalQueueEarlyCommitment({ artifacts, stEthAddress, wstETHAddress, deployer }) {
    const withdrawalQueueEarlyCommitmentContract = await deploy(
        'WithdrawalQueueEarlyCommitment', artifacts, withArgs(stEthAddress, wstETHAddress, { from: deployer })
    )
    return { withdrawalQueueEarlyCommitmentContract }
}

module.exports = runOrWrapScript(deployWithdrawalQueueEarlyCommitmentContract, module)
