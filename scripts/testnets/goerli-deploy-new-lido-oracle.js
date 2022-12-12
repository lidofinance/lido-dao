const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveDeployTx } = require('../helpers/deploy')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const hre = require("hardhat")

const { APP_NAMES } = require('../multisig/constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = ['daoInitialSettings', `app:${APP_NAMES.LIDO}`]

async function deployLidoOracleNew({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)
  const lidoAddress = state[`app:${APP_NAMES.LIDO}`].proxyAddress
  const oldOracleAddress = state[`app:${APP_NAMES.ORACLE}`].proxyAddress
  log(`Using Lido contract address:`, yl(lidoAddress))

  const lido = await artifacts.require('Lido').at(lidoAddress)
  const treasuryAddr = await lido.getTreasury()

  log(`Using Lido Treasury contract address:`, yl(treasuryAddr))
  logSplitter()

  let LidoOracleNew = await hre.ethers.getContractFactory("LidoOracleNew")

  let oracle = await LidoOracleNew.deploy({ from: DEPLOYER })
  console.log(oracle.address)

  const oracleAdmin = DEPLOYER
  const epochsPerFrame = 10
  const slotsPerEpoch = 32
  const secondsPerSlot = 12
  const genesisTime = 1616508000
  const allowedBeaconBalanceAnnualRelativeIncrease = 3000
  const allowedBeaconBalanceRelativeDecrease = 5000

  console.log([
    oracleAdmin.toString(),
    epochsPerFrame.toString(),
    slotsPerEpoch.toString(),
    secondsPerSlot.toString(),
    genesisTime.toString(),
    allowedBeaconBalanceAnnualRelativeIncrease.toString(),
    allowedBeaconBalanceRelativeDecrease.toString(),
  ])

  // await oracle.initialize(
  //   oracleAdmin,
  //   lidoAddress,
  //   epochsPerFrame,
  //   slotsPerEpoch,
  //   secondsPerSlot,
  //   genesisTime,
  //   allowedBeaconBalanceAnnualRelativeIncrease,
  //   allowedBeaconBalanceRelativeDecrease
  // )

}

module.exports = runOrWrapScript(deployLidoOracleNew, module)
