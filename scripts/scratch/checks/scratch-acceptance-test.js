const path = require('path')
const chalk = require('chalk')
const BN = require('bn.js')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEvents } = require('@aragon/contract-helpers-test')
const { hash: namehash } = require('eth-ens-namehash')
const { toChecksumAddress } = require('web3-utils')

const runOrWrapScript = require('../../helpers/run-or-wrap-script')
const { log, yl } = require('../../helpers/log')
const { hexConcat, pad, ETH, tokens, div15, StETH, shares, prepIdsCountsPayload } = require('../../../test/helpers/utils')
const { getBalance } = require('../../../test/helpers/blockchain')
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

const NOR_STAKING_MODULE_TARGET_SHARE_BP = 10000  // 100%
const NOR_STAKING_MODULE_MODULE_FEE_BP = 500  // 5%
const NOR_STAKING_MODULE_TREASURY_FEE_BP = 500  // 5%
const STAKING_MODULE_MANAGE_ROLE = web3.utils.keccak256("STAKING_MODULE_MANAGE_ROLE")

if (!process.env.HARDHAT_FORKING_URL) {
  console.error('Env variable HARDHAT_FORKING_URL must be set to run fork acceptance tests')
  process.exit(1);
}
if (!process.env.NETWORK_STATE_FILE) {
  console.error('Env variable NETWORK_STATE_FILE must be set to run fork acceptance tests')
  process.exit(1);
}
const NETWORK_STATE_FILE=process.env.NETWORK_STATE_FILE






async function checkDAO({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()



  log.splitter()
  log(`Network ID: ${yl(netId)}`)

  const state = readStateFile(NETWORK_STATE_FILE)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  log.splitter()

  const StakingRouter = await artifacts.require('StakingRouter')
  const Lido = await artifacts.require('Lido')
  const Voting = await artifacts.require('Voting')
  const NodeOperatorsRegistry = await artifacts.require('NodeOperatorsRegistry')
  const DepositSecurityModule = await artifacts.require('DepositSecurityModule')

  const lido = await artifacts.require('Lido').at(state['app:lido'].proxyAddress)

  const stakingRouter = await StakingRouter.at(state.stakingRouter.address)
  const voting = await Voting.at(state['app:aragon-voting'].proxyAddress)
  const nodeOperatorsRegistry = await NodeOperatorsRegistry.at(state['app:node-operators-registry'].proxyAddress)
  const dsm = await DepositSecurityModule.at(state.depositSecurityModule.address)

  const lidoAddress = state['app:lido'].proxyAddress
  const withdrawalCredentials = await lido.getWithdrawalCredentials()
  console.log({ withdrawalCredentials })



  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await lido.getBeaconStat()
    assert.equals(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assert.equals(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assert.equals(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  const owner = state.owner
  const [user1, user2, depositor] = await ethers.getSigners()
  await ethers.provider.send('hardhat_impersonateAccount', [voting.address])
  await ethers.provider.send('hardhat_impersonateAccount', [dsm.address])
  await ethers.provider.send('hardhat_impersonateAccount', [owner])

  await lido.resume({ from: voting.address })

  // const initialLidoBalance = await ethers.provider.getBalance(lido.address)
  const initialLidoBalance = await getBalance(lido.address)

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

  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting.address, { from: owner })
  await stakingRouter.addStakingModule(
    state.nodeOperatorsRegistry.parameters.stakingModuleTypeId,
    nodeOperatorsRegistry.address,
    NOR_STAKING_MODULE_TARGET_SHARE_BP,
    NOR_STAKING_MODULE_MODULE_FEE_BP,
    NOR_STAKING_MODULE_TREASURY_FEE_BP,
    { from: voting.address }
  )
  await stakingRouter.renounceRole(STAKING_MODULE_MANAGE_ROLE, voting.address, { from: voting.address })


  await user1.sendTransaction({ to: lido.address, value: ETH(32) })
  await user2.sendTransaction({ to: lido.address, value: ETH(2) })

  assert.equals(await lido.getTotalPooledEther(), initialLidoBalance + BigInt(ETH(34)))
  assert.equals(await lido.getBufferedEther(), initialLidoBalance + BigInt(ETH(34)))

  await lido.deposit(MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: dsm.address })

  await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
}


module.exports = runOrWrapScript(checkDAO, module)
