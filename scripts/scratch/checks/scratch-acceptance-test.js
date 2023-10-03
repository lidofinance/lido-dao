const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')


const runOrWrapScript = require('../../helpers/run-or-wrap-script')
const { log, yl } = require('../../helpers/log')
const { hexConcat, pad, ETH, tokens, div15, StETH, shares, prepIdsCountsPayload, e27, e18, e9, toBN } = require('../../../test/helpers/utils')
const { reportOracle } = require('../../../test/helpers/oracle')
const { getBalance, advanceChainTime } = require('../../../test/helpers/blockchain')
const { readNetworkState, assertRequiredNetworkState, readStateFile } = require('../../helpers/persisted-network-state')
const { assertRole, assertMissingRole } = require('../../helpers/aragon')
const { assertLastEvent, assertSingleEvent } = require('../../helpers/events')
const { assert } = require('../../../test/helpers/assert')
const { percentToBP } = require('../../helpers/index')
const { resolveEnsAddress } = require('../../components/ens')

const { APP_NAMES } = require('../../constants')

const { assertAPMRegistryPermissions } = require('./apm')
const { assertInstalledApps } = require('./apps')
const { assertVesting } = require('./dao-token')

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmEnsName',
  'daoAragonId',
  'vestingParams',
  'daoInitialSettings',
  'lidoTemplate'
]

const STETH_TOKEN_NAME = 'Liquid staked Ether 2.0'
const STETH_TOKEN_SYMBOL = 'stETH'
const STETH_TOKEN_DECIMALS = 18
const UNLIMITED = 1000000000
const CURATED_MODULE_ID = 1
const CALLDATA = '0x0'
const MAX_DEPOSITS = 150
const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const MANAGE_MEMBERS_AND_QUORUM_ROLE = web3.utils.keccak256('MANAGE_MEMBERS_AND_QUORUM_ROLE')

if (!process.env.HARDHAT_FORKING_URL) {
  console.error('Env variable HARDHAT_FORKING_URL must be set to run fork acceptance tests')
  process.exit(1);
}
if (!process.env.NETWORK_STATE_FILE) {
  console.error('Env variable NETWORK_STATE_FILE must be set to run fork acceptance tests')
  process.exit(1);
}
const NETWORK_STATE_FILE=process.env.NETWORK_STATE_FILE



async function loadDeployedProtocol(state) {
  return {
    stakingRouter: await artifacts.require('StakingRouter').at(state.stakingRouter.address),
    lido: await artifacts.require('Lido').at(state['app:lido'].proxy.address),
    voting: await artifacts.require('Voting').at(state['app:aragon-voting'].proxy.address),
    agent: await artifacts.require('Agent').at(state['app:aragon-agent'].proxy.address),
    nodeOperatorsRegistry: await artifacts.require('NodeOperatorsRegistry').at(state['app:node-operators-registry'].proxy.address),
    depositSecurityModule: await artifacts.require('DepositSecurityModule').at(state.depositSecurityModule.address),
    accountingOracle: await artifacts.require('AccountingOracle').at(state.accountingOracle.address),
    hashConsensusForAO: await artifacts.require('HashConsensus').at(state.hashConsensusForAccounting.address),
    elRewardsVault: await artifacts.require('LidoExecutionLayerRewardsVault').at(state.executionLayerRewardsVault.address),
    withdrawalQueue: await artifacts.require('WithdrawalQueueERC721').at(state.withdrawalQueueERC721.address),
    ldo: await artifacts.require('MiniMeToken').at(state.daoTokenAddress),
  }
}


async function checkLDOCanBeTransferred(ldo, state) {
  const ldoHolder = Object.keys(state.vestingParams.holders)[0]
  await ethers.provider.send('hardhat_impersonateAccount', [ldoHolder])

  await ldo.transfer(ADDRESS_1, e18(1), { from: ldoHolder })
  assert.equals(await ldo.balanceOf(ADDRESS_1), e18(1))

  log.success("Transferred LDO")
}


async function prepareProtocolForSubmitDepositReportWithdrawalFlow(protocol, state, oracleMember1, oracleMember2) {
  const {
    stakingRouter,
    lido,
    voting,
    agent,
    nodeOperatorsRegistry,
    depositSecurityModule,
    accountingOracle,
    hashConsensusForAO,
    elRewardsVault,
    withdrawalQueue,
  } = protocol

  await ethers.provider.send('hardhat_impersonateAccount', [voting.address])
  await ethers.provider.send('hardhat_impersonateAccount', [depositSecurityModule.address])
  await ethers.provider.send('hardhat_impersonateAccount', [agent.address])

  await lido.resume({ from: voting.address })

  await withdrawalQueue.grantRole(await withdrawalQueue.RESUME_ROLE(), agent.address, { from: agent.address })
  await withdrawalQueue.resume({ from: agent.address })
  await withdrawalQueue.renounceRole(await withdrawalQueue.RESUME_ROLE(), agent.address, { from: agent.address })

  await nodeOperatorsRegistry.addNodeOperator('1', ADDRESS_1, { from: voting.address })
  await nodeOperatorsRegistry.addNodeOperator('2', ADDRESS_2, { from: voting.address })

  await nodeOperatorsRegistry.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting.address })
  await nodeOperatorsRegistry.addSigningKeys(
    0,
    3,
    hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
    hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
    { from: voting.address }
  )

  await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting.address })
  await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting.address })



  const quorum = 2
  await hashConsensusForAO.grantRole(MANAGE_MEMBERS_AND_QUORUM_ROLE, agent.address, { from: agent.address })
  await hashConsensusForAO.addMember(oracleMember1.address, quorum, { from: agent.address })
  await hashConsensusForAO.addMember(oracleMember2.address, quorum, { from: agent.address })
  await hashConsensusForAO.renounceRole(MANAGE_MEMBERS_AND_QUORUM_ROLE, agent.address, { from: agent.address })

  log.success('Protocol prepared for submit-deposit-report-withdraw flow')
}

async function checkSubmitDepositReportWithdrawal(protocol, state, user1, user2) {
  const {
    stakingRouter,
    lido,
    voting,
    agent,
    nodeOperatorsRegistry,
    depositSecurityModule,
    accountingOracle,
    hashConsensusForAO,
    elRewardsVault,
    withdrawalQueue,
  } = protocol


  const initialLidoBalance = await getBalance(lido.address)
  const chainSpec = state.chainSpec

  await user1.sendTransaction({ to: lido.address, value: ETH(34) })
  await user2.sendTransaction({ to: elRewardsVault.address, value: ETH(1) })
  log.success('Users submitted ether')

  assert.equals(await lido.balanceOf(user1.address), ETH(34))
  assert.equals(await lido.getTotalPooledEther(), initialLidoBalance + BigInt(ETH(34)))
  assert.equals(await lido.getBufferedEther(), initialLidoBalance + BigInt(ETH(34)))

  await lido.deposit(MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositSecurityModule.address })
  log.success('Ether deposited')


  assert.equals((await lido.getBeaconStat()).depositedValidators, 1)

  // const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
  //   const stat = (await lido.getBeaconStat()).depositedValidators
  //   assert.equals(stat.depositedValidators, depositedValidators, 'depositedValidators check')
  //   assert.equals(stat.beaconValidators, beaconValidators, 'beaconValidators check')
  //   assert.equals(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  // }
  // await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })


  const latestBlockTimestamp = (await ethers.provider.getBlock('latest')).timestamp
  const initialEpoch = Math.floor((latestBlockTimestamp - chainSpec.genesisTime)
    / (chainSpec.slotsPerEpoch * chainSpec.secondsPerSlot))
  await hashConsensusForAO.updateInitialEpoch(initialEpoch, { from: agent.address })


  const elRewardsVaultBalance = await web3.eth.getBalance(elRewardsVault.address)
  // const numValidators = 1
  // const clBalance = ETH(35)
  // await pushOracleReport(hashConsensusForAO, accountingOracle, 1, ETH(35), elRewardsVaultBalance)
  // await reportOracle(hashConsensusForAO, accountingOracle, { numValidators, clBalance, elRewardsVaultBalance })

  const initialUser1StethAmount = ETH(34)
  // const finalUser1StethAmount = '36699999999999999999'
  // assert.equals(await lido.balanceOf(user1.address), finalStethAmount)

  await lido.approve(withdrawalQueue.address, initialUser1StethAmount, { from: user1.address })
  const receipt = await withdrawalQueue.requestWithdrawals([initialUser1StethAmount], user1.address, { from: user1.address })
  const requestId = getEventArgument(receipt, 'WithdrawalRequested', 'requestId')
  log.success('Withdrawal request made')

  const initialEpochTimestamp = chainSpec.genesisTime + initialEpoch * chainSpec.slotsPerEpoch * chainSpec.secondsPerSlot
  const timeToWaitTillReportWindow = initialEpochTimestamp - latestBlockTimestamp
    + state.oracleReportSanityChecker.parameters.requestTimestampMargin + chainSpec.secondsPerSlot

  console.log({ timeToWaitTillReportWindow })

  await advanceChainTime(timeToWaitTillReportWindow)

  let stat = await lido.getBeaconStat()
  const clBalance = toBN(stat.depositedValidators).mul(toBN(e18(32)))


  const { refSlot } = await hashConsensusForAO.getCurrentFrame()

  { // Debug section
    const initialRefSlot = await hashConsensusForAO.getInitialRefSlot()

    const tmp = await withdrawalQueue.getWithdrawalStatus([requestId])
    const withdrawalRequestTimestamp = tmp[0].timestamp

    const reportTimestamp = +chainSpec.genesisTime + (+refSlot) * (+chainSpec.secondsPerSlot)
    const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp

    console.log({
      initialRefSlot: initialRefSlot.toString(),
      refSlot: refSlot.toString(),
      // hcInitialEpoch: hcInitialEpoch.toString(),
      reportTimestamp: reportTimestamp.toString(),
      blockTimestamp: blockTimestamp.toString(),
      genesisTime: chainSpec.genesisTime.toString(),
      withdrawalRequestTimestamp: withdrawalRequestTimestamp.toString(),
      latestBlockTimestamp,
      initialEpoch,
    })
  }

  // const hcInitialEpoch = await hashConsensusForAO.getFrameConfig().initialEpoch

  const withdrawalFinalizationBatches = [1]
  const simulatedShareRate = e27(1)
  await reportOracle(hashConsensusForAO, accountingOracle, {
    refSlot,
    numValidators: stat.depositedValidators,
    clBalance,
    elRewardsVaultBalance,
    withdrawalFinalizationBatches,
    simulatedShareRate,
  })


  await withdrawalQueue.claimWithdrawalsTo([requestId], [requestId], user1.address, { from: user1.address })
}

async function checkMainProtocolFlows({ web3 }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readStateFile(NETWORK_STATE_FILE)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  const protocol = await loadDeployedProtocol(state)
  const [user1, user2, oracleMember1, oracleMember2] = await ethers.getSigners()

  await checkLDOCanBeTransferred(protocol.ldo, state)

  await prepareProtocolForSubmitDepositReportWithdrawalFlow(protocol, state, oracleMember1, oracleMember2)
  await checkSubmitDepositReportWithdrawal(protocol, state, user1, user2)
}


module.exports = runOrWrapScript(checkMainProtocolFlows, module)
