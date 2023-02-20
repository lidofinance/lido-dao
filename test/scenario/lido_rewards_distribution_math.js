const { BN } = require('bn.js')
const { assertBn, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { waitBlocks } = require('../helpers/blockchain')
const { pad, ETH, hexConcat, toBN, calcSharesMintedAsFees } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { assert } = require('../helpers/assert')
const { DSMAttestMessage, DSMPauseMessage, signDepositData } = require('../helpers/signatures')
const { pushOracleReport } = require('../helpers/oracle')
const { SECONDS_PER_FRAME } = require('../helpers/constants')
const { oracleReportSanityCheckerStubFactory } = require('../helpers/factories')

const Lido = artifacts.require('Lido')

const initialHolderBalanceETH = 1

const tenKBN = new BN(10000)
// Fee and its distribution are in basis points, 10000 corresponding to 100%

// Total max fee is 10%
const totalFeePoints = 0.1 * 10000

// 50% goes to node operators
const nodeOperatorsFeePoints = 0.5 * 10000

const StakingModuleStatus = {
  Active: 0, // deposits and rewards allowed
  DepositsPaused: 1, // deposits NOT allowed, rewards allowed
  Stopped: 2 // deposits and rewards NOT allowed
}

contract('Lido: rewards distribution math', (addresses) => {
  const [, , , , , , , , , , , , , operator_1, operator_2, user1, user2, nobody] = addresses

  let pool, nodeOperatorsRegistry, token
  let stakingRouter
  let oracle, anotherCuratedModule
  let treasuryAddr, guardians, depositRoot
  let depositSecurityModule
  let voting, deployed, consensus

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

  async function reportBeacon(validatorsCount, balance) {
    const { submitDataTx } = await pushOracleReport(consensus, oracle, validatorsCount, balance)
    await ethers.provider.send('evm_increaseTime', [SECONDS_PER_FRAME + 1000])
    await ethers.provider.send('evm_mine')

    return submitDataTx
  }

  before(async () => {
    deployed = await deployProtocol({
      oracleReportSanityCheckerFactory: oracleReportSanityCheckerStubFactory,
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500
          }
        ]
      }
    })

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/0.8.9/StakingRouter.sol
    stakingRouter = deployed.stakingRouter

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorsRegistry = deployed.stakingModules[0]

    // mocks
    oracle = deployed.oracle
    consensus = deployed.consensusContract

    depositSecurityModule = deployed.depositSecurityModule
    treasuryAddr = deployed.treasury.address

    voting = deployed.voting.address

    guardians = deployed.guardians

    depositRoot = await deployed.depositContract.get_deposit_root()

    const withdrawalCredentials = pad('0x0202', 32)

    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
  })

  it(`initial treasury balance is zero`, async () => {
    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'treasury balance is zero')
  })

  it(`registers one node operator with one key`, async () => {
    await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })
    nodeOperator1.id = 0

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      1,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address
      }
    )

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')

    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator1.id, 1, { from: voting })

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'no validators have received the ether2')
    assertBn(ether2Stat.beaconBalance, 0, 'remote ether2 not reported yet')
  })

  it(`registers submit correctly`, async () => {
    const depositedEthValue = 34
    const depositAmount = ETH(depositedEthValue)
    const expectedTotalEther = ETH(depositedEthValue + initialHolderBalanceETH)

    const receipt = await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user1 })

    assertEvent(receipt, 'Transfer', { expectedArgs: { from: 0, to: user1, value: depositAmount } })

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 0, 'one validator have received the ether2')
    assertBn(ether2Stat.beaconBalance, 0, `no remote ether2 on validator's balance is reported yet`)

    assertBn(await pool.getBufferedEther(), expectedTotalEther, `all the ether is buffered until deposit`)
    assertBn(await pool.getTotalPooledEther(), expectedTotalEther, 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assertBn(await token.balanceOf(user1), depositAmount, 'user1 tokens')

    assertBn(await token.totalSupply(), expectedTotalEther, 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), expectedTotalEther, 'total shares')

    assertBn(await token.balanceOf(treasuryAddr), new BN(0), 'treasury balance is zero')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')

  })

  it(`the first deposit gets deployed`, async () => {
    const [curated] = await stakingRouter.getStakingModules()

    await ethers.provider.send('evm_increaseTime', [SECONDS_PER_FRAME *2])
    await ethers.provider.send('evm_mine')
    const block = await ethers.provider.getBlock('latest')

    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, curated.id, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]

    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      curated.id,
      keysOpIndex,
      '0x',
      signatures
    )
    assertBn(
      await nodeOperatorsRegistry.getUnusedSigningKeyCount(0),
      0,
      'no more available keys for the first validator'
    )
    assertBn(
      await token.balanceOf(user1),
      ETH(34),
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assertBn(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')
    assertBn(await token.totalSupply(), ETH(34 + initialHolderBalanceETH), 'token total supply')

    assertBn(await token.balanceOf(treasuryAddr), ETH(0), 'treasury balance equals buffered value')
    assertBn(await token.balanceOf(nodeOperator1.address), new BN(0), 'nodeOperator1 balance is zero')
  })

  it(`first report registers profit`, async () => {
    const profitAmountEth = 1
    const profitAmount = ETH(profitAmountEth)
    const reportingValue = ETH(32 + profitAmountEth)
    const prevTotalShares = await pool.getTotalShares()
    const nodeOperator1TokenBefore = await token.balanceOf(operator_1)
    // for some reason there's nothing in this receipt's log, so we're not going to use it

    const treasuryBalanceBefore = await pool.balanceOf(treasuryAddr)
    const nodeOperatorsRegistryBalanceBefore = await pool.balanceOf(nodeOperatorsRegistry.address)
    const treasurySharesBefore = await pool.sharesOf(treasuryAddr)
    const nodeOperatorsRegistrySharesBefore = await pool.sharesOf(nodeOperatorsRegistry.address)

    const receipt = await reportBeacon(1, reportingValue)

    const sharesMintedAsFees = calcSharesMintedAsFees(
      profitAmount,
      1000,
      10000,
      prevTotalShares,
      await pool.getTotalPooledEther()
    )

    const totalFeeToDistribute = await pool.getPooledEthByShares(sharesMintedAsFees)
    const nodeOperatorsSharesToMint = sharesMintedAsFees.div(toBN(2))
    const treasurySharesToMint = sharesMintedAsFees.sub(nodeOperatorsSharesToMint)
    const nodeOperatorsFeeToMint = await pool.getPooledEthByShares(nodeOperatorsSharesToMint)
    const treasuryFeeMint = await pool.getPooledEthByShares(treasurySharesToMint)

    assert.equals(
      await pool.sharesOf(nodeOperatorsRegistry.address),
      nodeOperatorsRegistrySharesBefore.add(nodeOperatorsSharesToMint),
      'nodeOperator1 shares are correct'
    )
    assert.equals(
      await pool.sharesOf(treasuryAddr),
      treasurySharesBefore.add(treasurySharesToMint),
      'treasury shares are correct'
    )
    assert.equalsDelta(
      await pool.balanceOf(treasuryAddr),
      treasuryBalanceBefore.add(treasuryFeeMint),
      1,
      'reported the expected total fee'
    )
    assert.equalsDelta(
      await pool.balanceOf(nodeOperatorsRegistry.address),
      nodeOperatorsRegistryBalanceBefore.add(nodeOperatorsFeeToMint),
      1,
      'reported the expected total fee'
    )

    assert.emits(
      receipt,
      'Transfer',
      {
        to: nodeOperatorsRegistry.address,
        value: nodeOperatorsFeeToMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'Transfer',
      {
        to: treasuryAddr,
        value: treasuryFeeMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'TransferShares',
      {
        to: nodeOperatorsRegistry.address,
        sharesValue: nodeOperatorsSharesToMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'TransferShares',
      {
        to: treasuryAddr,
        sharesValue: treasurySharesToMint
      },
      { abi: Lido.abi }
    )

    assert.equalsDelta(
      await token.balanceOf(user1),
      '34874285714285714286',
      1,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assertBn(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')

    assertBn(await token.totalSupply(), ETH(36), 'token total supply')
    assert.equals(await pool.getTotalShares(), prevTotalShares.add(sharesMintedAsFees))

    // TODO: check math after rewards distribution fixes
    await stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(1, [], [], { from: voting })

    assert.equalsDelta(
      await token.balanceOf(nodeOperator1.address),
      nodeOperatorsFeeToMint,
      1,
      'nodeOperator1 balance = fee'
    )

    const nodeOperator1TokenDelta = (await token.balanceOf(operator_1)) - nodeOperator1TokenBefore

    assert.equalsDelta(nodeOperator1TokenDelta, nodeOperatorsFeeToMint, 1, 'nodeOperator1 balance = fee')
  })

  it(`adds another node operator`, async () => {
    await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, 1, { from: voting })
    nodeOperator2.id = 1

    assertBn(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators')
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      1,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address
      }
    )
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator2.id, 1, { from: voting })

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(totalKeys, 1, 'total signing keys')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assertBn(unusedKeys, 1, 'unused signing keys')

    assertBn(await token.balanceOf(nodeOperator2.address), new BN(0), 'nodeOperator2 balance is zero')

    const ether2Stat = await pool.getBeaconStat()
    assertBn(ether2Stat.depositedValidators, 1, 'one validator have received the ether2')
    assertBn(ether2Stat.beaconBalance, ETH(33), 'remote ether2 not reported yet')
  })

  it(`deposits another amount to second operator's validator`, async () => {
    const depositedEthValue = 32
    const depositAmount = ETH(depositedEthValue)
    const awaitedShares = await pool.getSharesByPooledEth(depositAmount)
    const awaitedTokens = await pool.getPooledEthByShares(awaitedShares)

    const sharesBefore = await pool.getTotalShares()

    const receipt = await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user2 })

    // note: that number isn't equal to depositAmount
    assertEvent(receipt, 'Transfer', { expectedArgs: { from: 0, to: user2, value: awaitedTokens } })

    // 2 from the previous deposit of the first user
    assertBn(
      await pool.getBufferedEther(),
      ETH(depositedEthValue + 2 + initialHolderBalanceETH),
      `all the ether is buffered until deposit`
    )

    // The amount of tokens corresponding to the deposited ETH value was minted to the user
    assertBn(await token.balanceOf(user2), awaitedTokens, 'user2 tokens')

    // current deposit + firstDeposit + first profit
    assertBn(await token.totalSupply(), ETH(depositedEthValue + 34 + 1 + initialHolderBalanceETH), 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assertBn(await token.getTotalShares(), sharesBefore.add(awaitedShares), 'total shares')
  })

  it(`the second deposit gets deployed`, async () => {
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const [curated] = await stakingRouter.getStakingModules()

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      1,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address
      }
    )
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    const signatures = [
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[0]]
      ),
      signDepositData(
        await depositSecurityModule.ATTEST_MESSAGE_PREFIX(),
        block.number,
        block.hash,
        depositRoot,
        1,
        keysOpIndex,
        '0x00',
        guardians.privateKeys[guardians.addresses[1]]
      )
    ]

    const [_, deltas] = await getSharesTokenDeltas(
      () =>
        depositSecurityModule.depositBufferedEther(
          block.number,
          block.hash,
          depositRoot,
          curated.id,
          keysOpIndex,
          '0x00',
          signatures
        ),
      treasuryAddr,
      nodeOperator1.address,
      nodeOperator2.address,
      user1,
      user2
    )

    assertBn(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys')
    const zeroBn = new BN(0)
    // deposit doesn't change any kind of balances
    deltas.forEach((delta, i) => assertBn(delta, zeroBn, `delta ${i} is zero`))
  })

  it(`delta shares are zero on no profit reported after the deposit`, async () => {
    const [_, deltas] = await getSharesTokenDeltas(
      () => reportBeacon(2, ETH(32 + 1 + 32)),
      treasuryAddr,
      nodeOperator1.address,
      nodeOperator2.address,
      user1,
      user2
    )

    assertBn(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys')
    const zeroBn = new BN(0)
    // deposit doesn't change any kind of _shares_ balances
    deltas.forEach((delta, i) => i % 2 && assertBn(delta, zeroBn, `delta ${i} is zero`))
  })

  it(`balances change correctly on second profit`, async () => {
    const profitAmountEth = 2
    const profitAmount = ETH(profitAmountEth)
    const bufferedAmount = ETH(2)

    const reportingValue = ETH(65 + profitAmountEth)
    const prevTotalShares = await pool.getTotalShares()

    const treasurySharesBefore = await pool.sharesOf(treasuryAddr)
    const nodeOperatorsRegistrySharesBefore = await pool.sharesOf(nodeOperatorsRegistry.address)

    const nodeOperator1SharesBefore = await pool.sharesOf(nodeOperator1.address)
    const nodeOperator2SharesBefore = await pool.sharesOf(nodeOperator2.address)

    const receipt = await reportBeacon(2, reportingValue)

    const sharesMintedAsFees = calcSharesMintedAsFees(
      profitAmount,
      1000,
      10000,
      prevTotalShares,
      await pool.getTotalPooledEther()
    )
    const totalFeeToDistribute = await pool.getPooledEthByShares(sharesMintedAsFees)
    const nodeOperatorsSharesToMint = sharesMintedAsFees.div(toBN(2))
    const treasurySharesToMint = sharesMintedAsFees.sub(nodeOperatorsSharesToMint)
    const nodeOperatorsFeeToMint = await pool.getPooledEthByShares(nodeOperatorsSharesToMint)
    const treasuryFeeMint = await pool.getPooledEthByShares(treasurySharesToMint)

    assert.equals(
      await pool.sharesOf(nodeOperatorsRegistry.address),
      nodeOperatorsRegistrySharesBefore.add(nodeOperatorsSharesToMint),
      'nodeOperatorRegistry shares are correct'
    )
    assert.equals(
      await pool.sharesOf(treasuryAddr),
      treasurySharesBefore.add(treasurySharesToMint),
      'treasury shares are correct'
    )
    assert.equalsDelta(
      await pool.balanceOf(treasuryAddr),
      await pool.getPooledEthByShares(treasurySharesBefore.add(treasurySharesToMint)),
      1,
      'treasury fee'
    )
    assert.equalsDelta(
      await pool.balanceOf(nodeOperatorsRegistry.address),
      await pool.getPooledEthByShares(nodeOperatorsRegistrySharesBefore.add(nodeOperatorsSharesToMint)),
      1,
      'nodeOperatorRegistry fee'
    )

    assert.emits(
      receipt,
      'Transfer',
      {
        to: nodeOperatorsRegistry.address,
        value: nodeOperatorsFeeToMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'Transfer',
      {
        to: treasuryAddr,
        value: treasuryFeeMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'TransferShares',
      {
        to: nodeOperatorsRegistry.address,
        sharesValue: nodeOperatorsSharesToMint
      },
      { abi: Lido.abi }
    )
    assert.emits(
      receipt,
      'TransferShares',
      {
        to: treasuryAddr,
        sharesValue: treasurySharesToMint
      },
      { abi: Lido.abi }
    )

    assert.equalsDelta(
      await token.balanceOf(user1),
      '35797428571428571429',
      1,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assertBn(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')

    assertBn(await token.totalSupply(), ETH(70), 'token total supply')
    assert.equals(await pool.getTotalShares(), prevTotalShares.add(sharesMintedAsFees))

    // TODO: check math after rewards distribution fixes
    await stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(1, [], [], { from: voting })

    const nodeOperator1SharesDelta = (await token.sharesOf(nodeOperator1.address)).sub(nodeOperator1SharesBefore)
    const nodeOperator2SharesDelta = (await token.sharesOf(nodeOperator2.address)).sub(nodeOperator2SharesBefore)

    assertBn(
      nodeOperator2SharesDelta,
      await pool.sharesOf(nodeOperator2.address),
      'node operator 2 got only fee on balance'
    )

    assertBn(
      nodeOperator1SharesDelta.add(nodeOperator2SharesDelta),
      nodeOperatorsSharesToMint,
      'nodeOperator1 shares are correct'
    )
    assertBn(treasurySharesDelta, treasurySharesToMint, 'treasury shares are correct')

    assertBn(
      nodeOperator1SharesDelta,
      nodeOperator2SharesDelta,
      'operators with equal amount of validators received equal shares'
    )

    const reportingValueBN = new BN(reportingValue)
    const totalSupply = reportingValueBN.add(new BN(bufferedAmount))

    const treasuryBalanceAfter = valuesAfter[0]
    const treasuryShareBefore = valuesBefore[1]
    const user1BalanceAfter = valuesAfter[2]
    const user1SharesBefore = valuesBefore[3]
    const user2BalanceAfter = valuesAfter[4]
    const user2SharesBefore = valuesBefore[5]
    const singleNodeOperatorFeeShare = nodeOperatorsSharesToMint.div(new BN(2))

    const awaitingTotalShares = prevTotalShares.add(sharesToMint)

    assertBn(
      await token.balanceOf(nodeOperator1.address),
      nodeOperator1SharesBefore.add(singleNodeOperatorFeeShare).mul(totalSupply).div(awaitingTotalShares),
      `first node operator token balance is correct`
    )
    assertBn(
      await token.balanceOf(nodeOperator2.address),
      nodeOperator2SharesBefore.add(singleNodeOperatorFeeShare).mul(totalSupply).div(awaitingTotalShares),
      `first node operator token balance is correct`
    )
    assertBn(
      treasuryBalanceAfter,
      treasuryShareBefore.add(treasurySharesToMint).mul(totalSupply).div(awaitingTotalShares),
      'treasury token balance changed correctly'
    )
    assertBn(user1SharesDelta, new BN(0), `user1 didn't get any shares from profit`)
    assertBn(
      user1BalanceAfter,
      user1SharesBefore.mul(totalSupply).div(awaitingTotalShares),
      `user1 token balance increased`
    )
    assertBn(user2SharesDelta, new BN(0), `user2 didn't get any shares from profit`)
    assertBn(
      user2BalanceAfter,
      user2SharesBefore.mul(totalSupply).div(awaitingTotalShares),
      `user2 token balance increased`
    )
  })

  it(`add another staking module`, async () => {
    anotherCuratedModule = await setupNodeOperatorsRegistry(deployed)
    await stakingRouter.addStakingModule(
      'Curated limited',
      anotherCuratedModule.address,
      5_000, // 50 % _targetShare
      100, // 1 % _moduleFee
      100, // 1 % _treasuryFee
      { from: voting }
    )

    const modulesList = await stakingRouter.getStakingModules()

    assert(modulesList.length, 2, 'module added')

    const operator = {
      name: 'operator',
      address: operator_2,
      validators: [...Array(10).keys()].map((i) => ({
        key: pad('0xaa01' + i.toString(16), 48),
        sig: pad('0x' + i.toString(16), 96)
      }))
    }
    const validatorsCount = 10
    await anotherCuratedModule.addNodeOperator(operator.name, operator.address, { from: voting })
    await anotherCuratedModule.addSigningKeysOperatorBH(
      0,
      validatorsCount,
      hexConcat(...operator.validators.map((v) => v.key)),
      hexConcat(...operator.validators.map((v) => v.sig)),
      {
        from: operator.address
      }
    )
    await anotherCuratedModule.setNodeOperatorStakingLimit(0, validatorsCount, { from: voting })
    assertBn(
      await anotherCuratedModule.getUnusedSigningKeyCount(0),
      validatorsCount,
      'operator of module has 10 unused keys'
    )
  })

  it(`deposit to new module`, async () => {
    const depositAmount = ETH(32)
    await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user1 })

    const [_, newCurated] = await stakingRouter.getStakingModules()

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, 0, { from: voting })

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await anotherCuratedModule.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, newCurated.id, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]])
    ]

    const user1BalanceBefore = await token.balanceOf(user1)
    const user1SharesBefore = await token.sharesOf(user1)
    const totalSupplyBefore = await token.totalSupply()

    assertBn(await anotherCuratedModule.getUnusedSigningKeyCount(0), 10, 'operator of module has 10 unused keys')
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      newCurated.id,
      keysOpIndex,
      '0x',
      signatures
    )
    assertBn(await anotherCuratedModule.getUnusedSigningKeyCount(0), 9, 'operator of module has 9 unused keys')

    assertBn(
      await token.balanceOf(user1),
      user1BalanceBefore,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assertBn(await token.sharesOf(user1), user1SharesBefore, 'user1 shares are equal to the first deposit')
    assertBn(await token.totalSupply(), totalSupplyBefore, 'token total supply')
    assertBn(await token.getBufferedEther(), ETH(3), '')
  })

  it(`rewards distribution`, async () => {
    const bufferedBefore = await token.getBufferedEther()
    const totalPooledEtherBefore = await token.getTotalPooledEther()
    // FIXME: oracle doesn't support reporting anything smaller than 1 gwei, here we're trying to report 2 wei
    const newBeaconBalance = totalPooledEtherBefore.sub(bufferedBefore).add(new BN(2))

    const firstModuleSharesBefore = await token.sharesOf(nodeOperatorsRegistry.address)
    const secondModuleSharesBefore = await token.sharesOf(anotherCuratedModule.address)
    const treasurySharesBefore = await await token.sharesOf(treasuryAddr)

    await reportBeacon(3, newBeaconBalance)

    assert.equalsDelta(await token.totalSupply(), newBeaconBalance.add(bufferedBefore), 1, 'token total supply')

    const rewardsToDistribute = await token.getSharesByPooledEth(
      newBeaconBalance.add(bufferedBefore).sub(totalPooledEtherBefore)
    )

    const { treasuryFee } = await stakingRouter.getStakingFeeAggregateDistribution()
    const { stakingModuleFees, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()
    const [firstModuleFee, secondModuleFee] = stakingModuleFees
    const expectedRewardsDistribution = {
      firstModule: rewardsToDistribute.mul(firstModuleFee).div(precisionPoints),
      secondModule: rewardsToDistribute.mul(secondModuleFee).div(precisionPoints),
      treasury: rewardsToDistribute.mul(treasuryFee).div(precisionPoints)
    }

    const firstModuleSharesAfter = await token.sharesOf(nodeOperatorsRegistry.address)
    const secondModuleSharesAfter = await token.sharesOf(anotherCuratedModule.address)
    const treasurySharesAfter = await await token.sharesOf(treasuryAddr)

    assertBn(
      firstModuleSharesAfter,
      firstModuleSharesBefore.add(expectedRewardsDistribution.firstModule),
      'first module balance'
    )
    assertBn(
      secondModuleSharesAfter,
      secondModuleSharesBefore.add(expectedRewardsDistribution.secondModule),
      'second module balance'
    )
    assertBn(treasurySharesAfter, treasurySharesBefore.add(expectedRewardsDistribution.treasury), 'treasury balance')
  })

  it(`module rewards should received by treasury if module stopped`, async () => {
    const [firstModule] = await stakingRouter.getStakingModules()
    const totalPooledEtherBefore = await token.getTotalPooledEther()
    const bufferedBefore = await token.getBufferedEther()
    // FIXME: oracle doesn't support reporting anything smaller than 1 gwei, here we're trying to report 1 wei
    const newBeaconBalance = totalPooledEtherBefore.sub(bufferedBefore).add(new BN(1))

    await stakingRouter.setStakingModuleStatus(firstModule.id, StakingModuleStatus.Stopped, { from: voting })

    const firstModuleSharesBefore = await token.sharesOf(nodeOperatorsRegistry.address)
    const secondModuleSharesBefore = await token.sharesOf(anotherCuratedModule.address)
    const treasurySharesBefore = await await token.sharesOf(treasuryAddr)

    await reportBeacon(3, newBeaconBalance)

    assert.equalsDelta(await token.totalSupply(), newBeaconBalance.add(bufferedBefore), 1, 'token total supply')

    const rewardsToDistribute = await token.getSharesByPooledEth(
      newBeaconBalance.add(bufferedBefore).sub(totalPooledEtherBefore)
    )
    const { treasuryFee } = await stakingRouter.getStakingFeeAggregateDistribution()
    const { stakingModuleFees, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()
    const [firstModuleFee, secondModuleFee] = stakingModuleFees
    const expectedRewardsDistribution = {
      firstModule: new BN(0),
      secondModule: rewardsToDistribute.mul(secondModuleFee).div(precisionPoints),
      treasury: rewardsToDistribute.mul(treasuryFee.add(firstModuleFee)).div(precisionPoints)
    }

    const firstModuleSharesAfter = await token.sharesOf(nodeOperatorsRegistry.address)
    const secondModuleSharesAfter = await token.sharesOf(anotherCuratedModule.address)
    const treasurySharesAfter = await token.sharesOf(treasuryAddr)

    assertBn(
      firstModuleSharesAfter,
      firstModuleSharesBefore.add(expectedRewardsDistribution.firstModule),
      'first module balance'
    )
    assertBn(
      secondModuleSharesAfter,
      secondModuleSharesBefore.add(expectedRewardsDistribution.secondModule),
      'second module balance'
    )
    assertBn(treasurySharesAfter, treasurySharesBefore.add(expectedRewardsDistribution.treasury), 'treasury balance')
  })

  // test multiple staking modules reward distribution
  async function getAwaitedFeesSharesTokensDeltas(profitAmount, prevTotalShares, validatorsCount) {
    const totalPooledEther = await pool.getTotalPooledEther()
    const totalShares = await pool.getTotalShares()

    const totalFeeToDistribute = new BN(profitAmount).mul(new BN(totalFeePoints)).div(tenKBN)

    const sharesToMintSol = new BN(profitAmount)
      .mul(new BN(totalFeePoints))
      .mul(prevTotalShares)
      .div(totalPooledEther.mul(tenKBN).sub(new BN(profitAmount).mul(new BN(totalFeePoints))))

    const sharesToMint = totalFeeToDistribute.mul(prevTotalShares).div(totalPooledEther.sub(totalFeeToDistribute))

    assert.equals(sharesToMintSol, sharesToMint)

    const nodeOperatorsSharesToMint = sharesToMint.mul(new BN(nodeOperatorsFeePoints)).div(tenKBN)
    const treasurySharesToMint = sharesToMint.sub(nodeOperatorsSharesToMint)

    const validatorsCountBN = new BN(validatorsCount)

    const nodeOperatorsFeeToMint = nodeOperatorsSharesToMint
      .mul(totalPooledEther)
      .div(totalShares)
      .div(validatorsCountBN)
      .mul(validatorsCountBN)
    const treasuryFeeToMint = treasurySharesToMint.mul(totalPooledEther).div(totalShares)

    return {
      totalPooledEther,
      totalShares,
      totalFeeToDistribute,
      sharesToMint,
      nodeOperatorsSharesToMint,
      treasurySharesToMint,
      nodeOperatorsFeeToMint,
      treasuryFeeToMint
    }
  }

  async function getSharesTokenDeltas(tx, ...addresses) {
    const valuesBefore = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    const receipt = await tx()
    const valuesAfter = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    return [{ receipt, valuesBefore, valuesAfter }, valuesAfter.map((val, i) => val.sub(valuesBefore[i]))]
  }

  async function readLastPoolEventLog() {
    const events = await pool.getPastEvents('Transfer')
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
