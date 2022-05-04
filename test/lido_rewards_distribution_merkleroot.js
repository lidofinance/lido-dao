const { assert } = require('chai')
const { BN } = require('bn.js')
const { assertBn, assertEvent, assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

// create merkle
const keccak256 = require('keccak256')
const { MerkleTree } = require('merkletreejs')

const { pad, ETH } = require('./helpers/utils')
const { deployDaoAndPool } = require('./scenario/helpers/deploy')
const { signDepositData } = require('./0.8.9/helpers/signatures')
const { waitBlocks } = require('./helpers/blockchain')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const MerkleDistributor = artifacts.require('MerkleDistributor')

const tenKBN = new BN(10000)

// Fee and its distribution are in basis points, 10000 corresponding to 100%

// Total fee is 10%
const totalFeePoints = 0.1 * 10000

// Of this 10%, 0% goes to the treasury
const treasuryFeePoints = 0
// 50% goes to the insurance fund
const insuranceFeePoints = 0.5 * 10000
// 50% goes to node operators
const nodeOperatorsFeePoints = 0.5 * 10000

const operatorsRewards = {}
const nodeOperators = []

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
  let merkle

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

    merkle = await MerkleDistributor.new(pool.address)
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
    const reportingValue = ETH(32 + profitAmountEth)

    // report 32+1 ETH
    await reportBeacon(1, reportingValue)

    // generate MerkleRoot
    const nodeOperatorsUndistributedShares = await pool.getNodeOperatorsUndistributedShares()
    const operatorsDistribute = await nodeOperatorRegistry.getRewardsDistribution(nodeOperatorsUndistributedShares)

    const { merkleRoot, tree } = generateMerkleRoot(operatorsDistribute)

    await merkle.setMerkleRoot(merkleRoot)

    // get operator leaf
    const operatorAddress = nodeOperator1.address
    const operatorSharesHex = '0xad0e08c044b00b'
    const operatorSharesNum = new BN(operatorSharesHex.replace(/^0x/, ''), 16)

    const leaf = MerkleTree.bufferToHex(keccak256(operatorAddress + operatorSharesNum.toString(16, 64)))
    const claimProof = tree.getHexProof(leaf)

    await merkle.claim(operatorSharesNum.toString(), claimProof, { from: operatorAddress })

    const nodeOperatorsUndistributedSharesAfter = await pool.getNodeOperatorsUndistributedShares()

    assert.equal(nodeOperatorsUndistributedSharesAfter, 0, 'shares exists')

    // nothing to cliams
    await assertRevert(merkle.claim(operatorSharesNum.toString(), claimProof, { from: operatorAddress }), 'Nothing to claim')

    nodeOperator1Balance = await pool.balanceOf(nodeOperator1.address)
    // console.log(nodeOperator1Balance.toString())
  })

  it('second report register profit', async () => {
    const profitAmountEth = 1
    const reportingValue = ETH(32 + 1 + profitAmountEth)

    // 1 validor + 1ETH first report + 1ETH second report
    await reportBeacon(1, reportingValue)

    // genereate merkle root
    const nodeOperatorsUndistributedShares = await pool.getNodeOperatorsUndistributedShares()
    const operatorsDistribute = await nodeOperatorRegistry.getRewardsDistribution(nodeOperatorsUndistributedShares)

    const { merkleRoot, tree, accounts } = generateMerkleRoot(operatorsDistribute)

    await merkle.setMerkleRoot(merkleRoot)

    // get operator leaf
    const operatorAddress = nodeOperator1.address
    const operatorSharesHex = '0x155c56eb29fe603'
    const operatorSharesNum = new BN(operatorSharesHex.replace(/^0x/, ''), 16)

    const leaf = MerkleTree.bufferToHex(keccak256(operatorAddress + operatorSharesNum.toString(16, 64)))
    const claimProof = tree.getHexProof(leaf)

    await merkle.claim(operatorSharesNum.toString(), claimProof, { from: operatorAddress })

    const nodeOperatorsUndistributedSharesAfter = await pool.getNodeOperatorsUndistributedShares()

    assert.equal(nodeOperatorsUndistributedSharesAfter, 0, 'shares exists')

    nodeOperator1Balance = await pool.balanceOf(nodeOperator1.address)
    // console.log(nodeOperator1Balance.toString())
  })
})

function generateMerkleRoot(operatorsDistribute) {
  const accounts = {}
  for (let i = 0; i < operatorsDistribute.recipients.length; i++) {
    const operator = operatorsDistribute.recipients[i]
    const shares = operatorsDistribute.shares[i]

    // offline part??

    operatorsRewards[operator] = operatorsRewards[operator] ? new BN(operatorsRewards[operator]).add(shares) : new BN(shares)

    accounts[operator] = `0x${new BN(operatorsRewards[operator]).toString(16)}`
  }

  const total = Object.keys(accounts).reduce((memo, key) => memo.add(new BN(accounts[key].replace(/^0x/, ''), 16)), new BN(0))

  const leaves = Object.keys(accounts).map((address) =>
    keccak256(address + new BN(accounts[address].replace(/^0x/, ''), 16).toString(16, 64))
  )
  const tree = new MerkleTree(leaves, keccak256, { sort: true })
  const merkleRoot = tree.getHexRoot()

  const totalRewards = '0x' + total.toString(16)
  return { merkleRoot, tree, accounts, totalRewards }
}
