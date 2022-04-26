const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { pad, ETH } = require('./helpers/utils')
const { deployDaoAndPool } = require('./scenario/helpers/deploy')
const { signDepositData } = require('./0.8.9/helpers/signatures')
const { waitBlocks } = require('./helpers/blockchain')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const tenKBN = new BN(10000)

// Fee and its distribution are in basis points, 10000 corresponding to 100%

// Total fee is 1%
const totalFeePoints = 0.01 * 10000

// Of this 1%, 30% goes to the treasury
const treasuryFeePoints = 0.3 * 10000
// 20% goes to the insurance fund
const insuranceFeePoints = 0.2 * 10000
// 50% goes to node operators
const nodeOperatorsFeePoints = 0.5 * 10000

contract('Lido: rewards distribution math', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    operator_1,
    operator_2,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody
  ] = addresses

  let pool, nodeOperatorRegistry, token
  let oracleMock
  let treasuryAddr, insuranceAddr, guardians
  let depositSecurityModule, depositRoot

  const withdrawalCredentials = pad('0x0202', 32)

  // Each node operator has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  const nodeOperator1 = {
    name: 'operator_1',
    address: operator_1,
    validators: [
      {
        key: pad('0x010101', 48),
        sig: pad('0x01', 96)
      },
      {
        key: pad('0x030303', 48),
        sig: pad('0x03', 96)
      }
    ]
  }

  const nodeOperator2 = {
    name: 'operator_2',
    address: operator_2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96)
      }
    ]
  }

  var epoch = 100

  function reportBeacon(validatorsCount, balance) {
    return oracleMock.reportBeacon(epoch++, validatorsCount, balance)
  }

  before(async () => {
    const deployed = await deployDaoAndPool(appManager, voting)

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry

    // mocks
    oracleMock = deployed.oracleMock

    // addresses
    treasuryAddr = deployed.treasuryAddr
    insuranceAddr = deployed.insuranceAddr
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians

    depositRoot = await deployed.depositContractMock.get_deposit_root()

    await pool.setFee(totalFeePoints, { from: voting })
    await pool.setFeeDistribution(treasuryFeePoints, insuranceFeePoints, nodeOperatorsFeePoints, { from: voting })
    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
  })

  it(`initial treasury & insurance balances are zero`, async () => {
    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'treasury balance is zero')
    assertBn(await token.balanceOf(insuranceAddr), new BN(0), 'insurance balance is zero')
  })

  it('add 1st operator', async () => {
    const validatorsLimit = 0

    const txn = await nodeOperatorRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })
    await nodeOperatorRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })
    assertBn(nodeOperator1.id, 0, 'operator id')

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), 1, 'total node operators')
    await nodeOperatorRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      1,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address
      }
    )

    const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    const unusedKeys = await nodeOperatorRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')

    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')

    await nodeOperatorRegistry.setNodeOperatorStakingLimit(nodeOperator1.id, 1, { from: voting })

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'no validators have received the ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2 not reported yet')
  })

  it(`registers submit correctly`, async () => {
    const depostitEthValue = 34
    const depositAmount = ETH(depostitEthValue)

    const receipt = await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user1 })

    const ether2Stat = await pool.getBeaconStat()

    assertBn(await pool.getBufferedEther(), depositAmount, `all the ether is buffered until deposit`)
    assertBn(await pool.getTotalPooledEther(), depositAmount, 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), depositAmount, 'user1 tokens')

    assertBn(await token.totalSupply(), depositAmount, 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), depositAmount, 'total shares')

    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'treasury balance is zero')
    assertBn(await token.balanceOf(insuranceAddr), new BN(0), 'insurance balance is zero')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')
  })

  it(`the first deposit gets deployed`, async () => {
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorRegistry.getKeysOpIndex()
    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        depositRoot,
        keysOpIndex,
        block.number,
        block.hash,
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]

    await depositSecurityModule.depositBufferedEther(depositRoot, keysOpIndex, block.number, block.hash, signatures)

    assertBn(await nodeOperatorRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys for the first validator')
    assertBn(await token.balanceOf(user1), ETH(34), 'user1 balance is equal first reported value + their buffered deposit value')
    assertBn(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')
    assertBn(await token.totalSupply(), ETH(34), 'token total supply')

    assertBn(await token.balanceOf(treasuryAddr), ETH(0), 'treasury balance equals buffered value')
    assertBn(await token.balanceOf(insuranceAddr), new BN(0), 'insurance balance is zero')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')
  })

  it(`first report registers profit`, async () => {
    const profitAmountEth = 1
    const profitAmount = ETH(profitAmountEth)
    const reportingValue = ETH(32 + profitAmountEth)
    const prevTotalShares = await pool.getTotalShares()

    // for some reason there's nothing in this receipt's log, so we're not going to use it
    const [{ receipt }, deltas] = await getSharesTokenDeltas(
      () => reportBeacon(1, reportingValue),
      treasuryAddr,
      insuranceAddr,
      nodeOperator1.address,
      user1
    )

    const [
      treasuryTokenDelta,
      treasurySharesDelta,
      insuranceTokenDelta,
      insuranceSharesDelta,
      nodeOperator1TokenDelta,
      nodeOperator1SharesDelta,
      user1TokenDelta,
      user1SharesDelta
    ] = deltas

    console.log({
      treasuryTokenDelta: treasuryTokenDelta.toString(),
      treasurySharesDelta: treasurySharesDelta.toString(),
      insuranceTokenDelta: insuranceTokenDelta.toString(),
      insuranceSharesDelta: insuranceSharesDelta.toString(),
      nodeOperator1TokenDelta: nodeOperator1TokenDelta.toString(),
      nodeOperator1SharesDelta: nodeOperator1SharesDelta.toString(),
      user1TokenDelta: user1TokenDelta.toString(),
      user1SharesDelta: user1SharesDelta.toString()
    })
  })

  async function getSharesTokenDeltas(tx, ...addresses) {
    const valuesBefore = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    const receipt = await tx()
    const valuesAfter = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    return [{ receipt, valuesBefore, valuesAfter }, valuesAfter.map((val, i) => val.sub(valuesBefore[i]))]
  }

  async function readLastPoolEventLog() {
    const events = await pool.getPastEvents()
    let reportedMintAmount = new BN(0)
    const tos = []
    const values = []
    events.forEach(({ args }) => {
      reportedMintAmount = reportedMintAmount.add(args.value)
      tos.push(args.to)
      values.push(args.value)
    })
    return {
      reportedMintAmount,
      tos,
      values
    }
  }
})
