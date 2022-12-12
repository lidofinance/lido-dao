const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const hre = require("hardhat")
const { bn } = require('@aragon/contract-helpers-test')

const DEPLOYER = process.env.DEPLOYER || ''

const blockDurationSeconds = 12
const secondsInDay = 24 * 60 * 60
const blocksInDay = secondsInDay / blockDurationSeconds


async function deployValidatorExitBus({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  let ValidatorExitBus = await hre.ethers.getContractFactory("ValidatorExitBus")
  let bus = await ValidatorExitBus.deploy()
  console.log(bus.address)

  const admin = DEPLOYER
  const maxRequestsPerDayE18 = bn(5400).mul(bn(10).pow(bn(18)))
  const numRequestsLimitIncreasePerBlockE18 = maxRequestsPerDayE18.div(bn(blocksInDay))
  const epochsPerFrame = 10
  const slotsPerEpoch = 32
  const secondsPerSlot = 12
  const genesisTime = 1616508000
  console.log([
    admin.toString(),
    maxRequestsPerDayE18.toString(),
    numRequestsLimitIncreasePerBlockE18.toString(),
    epochsPerFrame.toString(),
    slotsPerEpoch.toString(),
    secondsPerSlot.toString(),
    genesisTime.toString(),
  ])

  // await bus.initialize(
  //   admin,
  //   maxRequestsPerDayE18,
  //   numRequestsLimitIncreasePerBlockE18,
  //   epochsPerFrame,
  //   slotsPerEpoch,
  //   secondsPerSlot,
  //   genesisTime,
  //   { from: DEPLOYER }
  // )

  log('Initialized.')

}

module.exports = runOrWrapScript(deployValidatorExitBus, module)
