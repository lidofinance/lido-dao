const { contract, artifacts, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { waitBlocks } = require('../helpers/blockchain')
const { pad, ETH, hexConcat, toBN, calcSharesMintedAsFees } = require('../helpers/utils')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')

const { DSMAttestMessage, DSMPauseMessage, signDepositData } = require('../helpers/signatures')
const { pushOracleReport } = require('../helpers/oracle')
const { SECONDS_PER_FRAME, ZERO_ADDRESS } = require('../helpers/constants')
const { oracleReportSanityCheckerStubFactory } = require('../helpers/factories')

const Lido = artifacts.require('Lido')

const initialHolderBalanceETH = 1

const StakingModuleStatus = {
  Active: 0, // deposits and rewards allowed
  DepositsPaused: 1, // deposits NOT allowed, rewards allowed
  Stopped: 2, // deposits and rewards NOT allowed
}

contract('Lido: rewards distribution math', (addresses) => {
  const [, , , , , , , , , , , , , operator_1, operator_2, operator_3, user1, user2, nobody] = addresses

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
        sig: pad('0x01', 96),
      },
      {
        key: pad('0x030303', 48),
        sig: pad('0x03', 96),
      },
    ],
  }

  const nodeOperator2 = {
    name: 'operator_2',
    address: operator_2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96),
      },
    ],
  }

  const nodeOperator3 = {
    name: 'operator',
    address: operator_3,
    validators: [...Array(10).keys()].map((i) => ({
      key: pad('0xaa01' + i.toString(16), 48),
      sig: pad('0x' + i.toString(16), 96),
    })),
  }

  async function reportBeacon(validatorsCount, balance) {
    const receipts = await pushOracleReport(consensus, oracle, validatorsCount, balance, 0)
    await ethers.provider.send('evm_increaseTime', [SECONDS_PER_FRAME + 1000])
    await ethers.provider.send('evm_mine')

    return receipts
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
            treasuryFee: 500,
          },
        ]
      },
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
    assert.equals(await token.balanceOf(treasuryAddr), 0, 'treasury balance is zero')
  })

  it(`registers one node operator with one key`, async () => {
    await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })
    nodeOperator1.id = 0

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      1,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address,
      }
    )

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')

    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'nodeOperator1 balance is zero')

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator1.id, 1, { from: voting })

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'no validators have received the ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2 not reported yet')
  })

  it(`registers submit correctly`, async () => {
    const depositedEthValue = 34
    const depositAmount = ETH(depositedEthValue)
    const expectedTotalEther = ETH(depositedEthValue + initialHolderBalanceETH)

    const receipt = await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user1 })

    assert.emits(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user1, value: depositAmount })

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'one validator have received the ether2')
    assert.equals(ether2Stat.beaconBalance, 0, `no remote ether2 on validator's balance is reported yet`)

    assert.equals(await pool.getBufferedEther(), expectedTotalEther, `all the ether is buffered until deposit`)
    assert.equals(await pool.getTotalPooledEther(), expectedTotalEther, 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user

    assert.equals(await token.balanceOf(user1), depositAmount, 'user1 tokens')

    assert.equals(await token.totalSupply(), expectedTotalEther, 'token total supply')
    // Total shares are equal to deposited eth before ratio change and fee mint
    assert.equals(await token.getTotalShares(), expectedTotalEther, 'total shares')

    assert.equals(await token.balanceOf(treasuryAddr), 0, 'treasury balance is zero')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'nodeOperator1 balance is zero')
  })

  it(`the first deposit gets deployed`, async () => {
    const [curated] = await stakingRouter.getStakingModules()

    await ethers.provider.send('evm_increaseTime', [SECONDS_PER_FRAME * 2])
    await ethers.provider.send('evm_mine')
    const block = await ethers.provider.getBlock('latest')

    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, curated.id, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
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
    assert.equals(
      await nodeOperatorsRegistry.getUnusedSigningKeyCount(0),
      0,
      'no more available keys for the first validator'
    )
    assert.equals(
      await token.balanceOf(user1),
      ETH(34),
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assert.equals(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')
    assert.equals(await token.totalSupply(), ETH(34 + initialHolderBalanceETH), 'token total supply')

    assert.equals(await token.balanceOf(treasuryAddr), ETH(0), 'treasury balance equals buffered value')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'nodeOperator1 balance is zero')
  })

  it(`first report registers profit`, async () => {
    const profitAmountEth = 1
    const profitAmount = ETH(profitAmountEth)
    const reportingValue = ETH(32 + profitAmountEth)
    const prevTotalShares = await pool.getTotalShares()
    // for some reason there's nothing in this receipt's log, so we're not going to use it

    const treasurySharesBefore = await pool.sharesOf(treasuryAddr)
    const nodeOperator1SharesBefore = await pool.sharesOf(nodeOperator1.address)

    const { submitDataTx, submitExtraDataTx } = await reportBeacon(1, reportingValue)

    const sharesMintedAsFees = calcSharesMintedAsFees(
      profitAmount,
      1000,
      10000,
      prevTotalShares,
      await pool.getTotalPooledEther()
    )

    const nodeOperatorsSharesToMint = sharesMintedAsFees.div(toBN(2))
    const treasurySharesToMint = sharesMintedAsFees.sub(nodeOperatorsSharesToMint)
    const nodeOperatorsFeeToMint = await pool.getPooledEthByShares(nodeOperatorsSharesToMint)
    const treasuryFeeMint = await pool.getPooledEthByShares(treasurySharesToMint)

    assert.equalsDelta(await pool.sharesOf(nodeOperatorsRegistry.address), 0, 1)
    assert.equals(
      await pool.sharesOf(nodeOperator1.address),
      nodeOperator1SharesBefore.add(nodeOperatorsSharesToMint),
      'nodeOperator1 shares are correct'
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
      'reported the expected total fee'
    )
    assert.equalsDelta(
      await pool.balanceOf(nodeOperator1.address),
      await pool.getPooledEthByShares(nodeOperator1SharesBefore.add(nodeOperatorsSharesToMint)),
      1,
      'reported the expected total fee'
    )

    assert.emits(
      submitDataTx,
      'Transfer',
      {
        to: nodeOperatorsRegistry.address,
        value: nodeOperatorsFeeToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'Transfer',
      {
        to: treasuryAddr,
        value: treasuryFeeMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'TransferShares',
      {
        to: nodeOperatorsRegistry.address,
        sharesValue: nodeOperatorsSharesToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'TransferShares',
      {
        to: treasuryAddr,
        sharesValue: treasurySharesToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'Transfer',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator1.address,
        value: nodeOperatorsFeeToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'TransferShares',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator1.address,
        sharesValue: nodeOperatorsSharesToMint.toString(),
      },
      { abi: Lido.abi }
    )

    assert.equalsDelta(
      await token.balanceOf(user1),
      '34874285714285714286',
      1,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assert.equals(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')

    assert.equals(await token.totalSupply(), ETH(36), 'token total supply')
    assert.equals(await pool.getTotalShares(), prevTotalShares.add(sharesMintedAsFees))
  })

  it(`adds another node operator`, async () => {
    await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, 1, { from: voting })
    nodeOperator2.id = 1

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators')
    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      1,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address,
      }
    )
    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(nodeOperator2.id, 1, { from: voting })

    const totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    const unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')

    assert.equals(await token.balanceOf(nodeOperator2.address), 0, 'nodeOperator2 balance is zero')

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 1, 'one validator have received the ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(33), 'remote ether2 not reported yet')
  })

  it(`deposits another amount to second operator's validator`, async () => {
    const depositedEthValue = 32
    const depositAmount = ETH(depositedEthValue)
    const awaitedShares = await pool.getSharesByPooledEth(depositAmount)
    const awaitedTokens = await pool.getPooledEthByShares(awaitedShares)

    const sharesBefore = await pool.getTotalShares()

    const receipt = await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user2 })

    // note: that number isn't equal to depositAmount
    assert.emits(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user2, value: awaitedTokens })

    // 2 from the previous deposit of the first user
    assert.equals(
      await pool.getBufferedEther(),
      ETH(depositedEthValue + 2 + initialHolderBalanceETH),
      `all the ether is buffered until deposit`
    )

    // The amount of tokens corresponding to the deposited ETH value was minted to the user
    assert.equals(await token.balanceOf(user2), awaitedTokens, 'user2 tokens')

    // current deposit + firstDeposit + first profit
    assert.equals(
      await token.totalSupply(),
      ETH(depositedEthValue + 34 + 1 + initialHolderBalanceETH),
      'token total supply'
    )
    // Total shares are equal to deposited eth before ratio change and fee mint
    assert.equals(await token.getTotalShares(), sharesBefore.add(awaitedShares), 'total shares')
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
        from: nodeOperator2.address,
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
      ),
    ]

    const [, deltas] = await getSharesTokenDeltas(
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

    assert.equals(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys')
    // deposit doesn't change any kind of balances
    deltas.forEach((delta, i) => assert.equals(delta, 0, `delta ${i} is zero`))
  })

  it(`delta shares are zero on no profit reported after the deposit`, async () => {
    const [, deltas] = await getSharesTokenDeltas(
      () => reportBeacon(2, ETH(32 + 1 + 32)),
      treasuryAddr,
      nodeOperator1.address,
      nodeOperator2.address,
      user1,
      user2
    )

    assert.equals(await nodeOperatorsRegistry.getUnusedSigningKeyCount(0), 0, 'no more available keys')
    // deposit doesn't change any kind of _shares_ balances
    deltas.forEach((delta, i) => i % 2 && assert.equals(delta, 0, `delta ${i} is zero`))
  })

  it(`balances change correctly on second profit`, async () => {
    const profitAmountEth = 2
    const profitAmount = ETH(profitAmountEth)

    const reportingValue = ETH(65 + profitAmountEth)
    const prevTotalShares = await pool.getTotalShares()

    const treasurySharesBefore = await pool.sharesOf(treasuryAddr)

    const nodeOperator1SharesBefore = await pool.sharesOf(nodeOperator1.address)
    const nodeOperator2SharesBefore = await pool.sharesOf(nodeOperator2.address)

    const { submitDataTx, submitExtraDataTx } = await reportBeacon(2, reportingValue)

    const sharesMintedAsFees = calcSharesMintedAsFees(
      profitAmount,
      1000,
      10000,
      prevTotalShares,
      await pool.getTotalPooledEther()
    )
    const nodeOperatorsSharesToMint = sharesMintedAsFees.div(toBN(2))
    const nodeOperatorSharesToMint = nodeOperatorsSharesToMint.div(toBN(2))
    const treasurySharesToMint = sharesMintedAsFees.sub(nodeOperatorsSharesToMint)
    const nodeOperatorsFeeToMint = await pool.getPooledEthByShares(nodeOperatorsSharesToMint)
    const nodeOperatorFeeToMint = await pool.getPooledEthByShares(nodeOperatorSharesToMint)
    const treasuryFeeMint = await pool.getPooledEthByShares(treasurySharesToMint)

    assert.equalsDelta(await pool.sharesOf(nodeOperatorsRegistry.address), 0, 1)

    assert.equals(
      await pool.sharesOf(nodeOperator1.address),
      nodeOperator1SharesBefore.add(nodeOperatorSharesToMint),
      'nodeOperator1 shares are correct'
    )

    assert.equals(
      await pool.sharesOf(nodeOperator2.address),
      nodeOperator2SharesBefore.add(nodeOperatorSharesToMint),
      'nodeOperator2 shares are correct'
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
      'reported the expected treasury fee'
    )
    assert.equalsDelta(
      await pool.balanceOf(nodeOperator1.address),
      await pool.getPooledEthByShares(nodeOperator1SharesBefore.add(nodeOperatorSharesToMint)),
      1,
      'reported the expected nodeOperator1 fee'
    )
    assert.equalsDelta(
      await pool.balanceOf(nodeOperator2.address),
      await pool.getPooledEthByShares(nodeOperator2SharesBefore.add(nodeOperatorSharesToMint)),
      1,
      'reported the expected nodeOperator2 fee'
    )

    assert.emits(
      submitDataTx,
      'Transfer',
      {
        to: nodeOperatorsRegistry.address,
        value: nodeOperatorsFeeToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'Transfer',
      {
        to: treasuryAddr,
        value: treasuryFeeMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'TransferShares',
      {
        to: nodeOperatorsRegistry.address,
        sharesValue: nodeOperatorsSharesToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitDataTx,
      'TransferShares',
      {
        to: treasuryAddr,
        sharesValue: treasurySharesToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'Transfer',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator1.address,
        value: nodeOperatorFeeToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'TransferShares',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator1.address,
        sharesValue: nodeOperatorSharesToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'Transfer',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator2.address,
        value: nodeOperatorFeeToMint,
      },
      { abi: Lido.abi }
    )
    assert.emits(
      submitExtraDataTx,
      'TransferShares',
      {
        from: nodeOperatorsRegistry.address,
        to: nodeOperator2.address,
        sharesValue: nodeOperatorSharesToMint,
      },
      { abi: Lido.abi }
    )

    assert.equalsDelta(
      await token.balanceOf(user1),
      '35797428571428571429',
      1,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assert.equals(await token.sharesOf(user1), ETH(34), 'user1 shares are equal to the first deposit')

    assert.equals(await token.totalSupply(), ETH(70), 'token total supply')
    assert.equals(await pool.getTotalShares(), prevTotalShares.add(sharesMintedAsFees))
  })

  it(`add another staking module`, async () => {
    anotherCuratedModule = await setupNodeOperatorsRegistry(deployed)
    await stakingRouter.addStakingModule(
      'Curated limited',
      anotherCuratedModule.address,
      5_000, // 50 % _targetShare
      2000, // 20 % _moduleFee
      2000, // 20 % _treasuryFee
      { from: voting }
    )

    await waitBlocks(+(await depositSecurityModule.getMaxDeposits()))

    const modulesList = await stakingRouter.getStakingModules()

    assert(modulesList.length, 2, 'module added')

    const validatorsCount = 10
    await anotherCuratedModule.addNodeOperator(nodeOperator3.name, nodeOperator3.address, { from: voting })
    await anotherCuratedModule.addSigningKeysOperatorBH(
      0,
      validatorsCount,
      hexConcat(...nodeOperator3.validators.map((v) => v.key)),
      hexConcat(...nodeOperator3.validators.map((v) => v.sig)),
      {
        from: nodeOperator3.address,
      }
    )
    await anotherCuratedModule.setNodeOperatorStakingLimit(0, validatorsCount, { from: voting })
    assert.equals(
      await anotherCuratedModule.getUnusedSigningKeyCount(0),
      validatorsCount,
      'operator of module has 10 unused keys'
    )
  })

  it(`deposit to new module`, async () => {
    const depositAmount = ETH(32)
    await pool.submit(ZERO_ADDRESS, { value: depositAmount, from: user1 })

    const [, newCurated] = await stakingRouter.getStakingModules()

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, 0, { from: voting })

    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await anotherCuratedModule.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(block.number, block.hash, depositRoot, newCurated.id, keysOpIndex)

    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]

    const user1BalanceBefore = await token.balanceOf(user1)
    const user1SharesBefore = await token.sharesOf(user1)
    const totalSupplyBefore = await token.totalSupply()

    assert.equals(await anotherCuratedModule.getUnusedSigningKeyCount(0), 10, 'operator of module has 10 unused keys')
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      newCurated.id,
      keysOpIndex,
      '0x',
      signatures
    )
    assert.equals(await anotherCuratedModule.getUnusedSigningKeyCount(0), 9, 'operator of module has 9 unused keys')

    assert.equals(
      await token.balanceOf(user1),
      user1BalanceBefore,
      'user1 balance is equal first reported value + their buffered deposit value'
    )
    assert.equals(await token.sharesOf(user1), user1SharesBefore, 'user1 shares are equal to the first deposit')
    assert.equals(await token.totalSupply(), totalSupplyBefore, 'token total supply')
    assert.equals(await token.getBufferedEther(), ETH(3), '')
  })

  it(`rewards distribution`, async () => {
    const bufferedBefore = await token.getBufferedEther()
    const totalSharesBefore = await token.getTotalShares()
    const totalPooledEtherBefore = await token.getTotalPooledEther()
    const rewardsAmount = ETH(1)
    const newBeaconBalance = totalPooledEtherBefore.sub(bufferedBefore).add(toBN(rewardsAmount))

    const treasurySharesBefore = await token.sharesOf(treasuryAddr)
    const nodeOperator1SharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2SharesBefore = await token.sharesOf(nodeOperator2.address)
    const nodeOperator3SharesBefore = await token.sharesOf(nodeOperator3.address)

    await reportBeacon(3, newBeaconBalance)

    assert.equals(await token.totalSupply(), totalPooledEtherBefore.add(toBN(rewardsAmount)), 'token total supply')

    const sharesMintedAsFees = calcSharesMintedAsFees(
      rewardsAmount,
      2000,
      10000,
      totalSharesBefore,
      await pool.getTotalPooledEther()
    )
    const treasureRewardsShares = sharesMintedAsFees.div(toBN(2))
    const nodeOperator1RewardsShares = sharesMintedAsFees.div(toBN(12))
    const nodeOperator2RewardsShares = sharesMintedAsFees.div(toBN(12))
    const nodeOperator3RewardsShares = sharesMintedAsFees.div(toBN(3))

    assert.equalsDelta(await token.sharesOf(nodeOperatorsRegistry.address), 0, 1, 'first module balance')
    assert.equalsDelta(await token.sharesOf(anotherCuratedModule.address), 0, 1, 'second module balance')

    assert.equalsDelta(
      await pool.sharesOf(treasuryAddr),
      treasurySharesBefore.add(treasureRewardsShares),
      1,
      'treasury shares'
    )
    assert.equals(
      await pool.sharesOf(nodeOperator1.address),
      nodeOperator1SharesBefore.add(nodeOperator1RewardsShares),
      'nodeOperator1 shares'
    )
    assert.equals(
      await pool.sharesOf(nodeOperator2.address),
      nodeOperator2SharesBefore.add(nodeOperator2RewardsShares),
      'nodeOperator2 shares'
    )
    assert.equals(
      await pool.sharesOf(nodeOperator3.address),
      nodeOperator3SharesBefore.add(nodeOperator3RewardsShares),
      'nodeOperator3 shares'
    )
  })

  it(`module rewards should received by treasury if module stopped`, async () => {
    const [firstModule] = await stakingRouter.getStakingModules()
    const totalSharesBefore = await token.getTotalShares()
    const totalPooledEtherBefore = await token.getTotalPooledEther()
    const bufferedBefore = await token.getBufferedEther()
    const rewardsAmount = ETH(1)
    const newBeaconBalance = totalPooledEtherBefore.sub(bufferedBefore).add(toBN(rewardsAmount))

    await stakingRouter.setStakingModuleStatus(firstModule.id, StakingModuleStatus.Stopped, { from: voting })

    const treasurySharesBefore = await token.sharesOf(treasuryAddr)
    const nodeOperator1SharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2SharesBefore = await token.sharesOf(nodeOperator2.address)
    const nodeOperator3SharesBefore = await token.sharesOf(nodeOperator3.address)

    await reportBeacon(3, newBeaconBalance)

    assert.equals(await token.totalSupply(), totalPooledEtherBefore.add(toBN(rewardsAmount)), 'token total supply')

    const sharesMintedAsFees = calcSharesMintedAsFees(
      rewardsAmount,
      2000,
      10000,
      totalSharesBefore,
      await pool.getTotalPooledEther()
    )
    const treasureRewardsShares = sharesMintedAsFees.mul(toBN(2)).div(toBN(3))
    const nodeOperator3RewardsShares = sharesMintedAsFees.div(toBN(3))

    assert.equalsDelta(await token.sharesOf(nodeOperatorsRegistry.address), 0, 1, 'first module balance')
    assert.equalsDelta(await token.sharesOf(anotherCuratedModule.address), 0, 1, 'second module balance')

    assert.equals(await pool.sharesOf(treasuryAddr), treasurySharesBefore.add(treasureRewardsShares), 'treasury shares')
    assert.equals(await pool.sharesOf(nodeOperator1.address), nodeOperator1SharesBefore, 'nodeOperator1 shares')
    assert.equals(await pool.sharesOf(nodeOperator2.address), nodeOperator2SharesBefore, 'nodeOperator2 shares')
    assert.equals(
      await pool.sharesOf(nodeOperator3.address),
      nodeOperator3SharesBefore.add(nodeOperator3RewardsShares),
      'nodeOperator3 shares'
    )
  })

  it(`module rewards should received by treasury if all modules stopped`, async () => {
    const [, secondModule] = await stakingRouter.getStakingModules()
    const totalSharesBefore = await token.getTotalShares()
    const totalPooledEtherBefore = await token.getTotalPooledEther()
    const bufferedBefore = await token.getBufferedEther()
    const rewardsAmount = ETH(1)
    const newBeaconBalance = totalPooledEtherBefore.sub(bufferedBefore).add(toBN(rewardsAmount))

    await stakingRouter.setStakingModuleStatus(secondModule.id, StakingModuleStatus.Stopped, { from: voting })

    const treasurySharesBefore = await token.sharesOf(treasuryAddr)
    const nodeOperator1SharesBefore = await token.sharesOf(nodeOperator1.address)
    const nodeOperator2SharesBefore = await token.sharesOf(nodeOperator2.address)
    const nodeOperator3SharesBefore = await token.sharesOf(nodeOperator3.address)

    await reportBeacon(3, newBeaconBalance)

    assert.equals(await token.totalSupply(), totalPooledEtherBefore.add(toBN(rewardsAmount)), 'token total supply')

    const sharesMintedAsFees = calcSharesMintedAsFees(
      rewardsAmount,
      2000,
      10000,
      totalSharesBefore,
      await pool.getTotalPooledEther()
    )

    assert.equalsDelta(await token.sharesOf(nodeOperatorsRegistry.address), 0, 1, 'first module balance')
    assert.equalsDelta(await token.sharesOf(anotherCuratedModule.address), 0, 1, 'second module balance')

    assert.equals(await pool.sharesOf(treasuryAddr), treasurySharesBefore.add(sharesMintedAsFees), 'treasury shares')
    assert.equals(await pool.sharesOf(nodeOperator1.address), nodeOperator1SharesBefore, 'nodeOperator1 shares')
    assert.equals(await pool.sharesOf(nodeOperator2.address), nodeOperator2SharesBefore, 'nodeOperator2 shares')
    assert.equals(await pool.sharesOf(nodeOperator3.address), nodeOperator3SharesBefore, 'nodeOperator3 shares')
  })

  async function getSharesTokenDeltas(tx, ...addresses) {
    const valuesBefore = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    const receipt = await tx()
    const valuesAfter = await Promise.all(addresses.flatMap((addr) => [token.balanceOf(addr), token.sharesOf(addr)]))
    return [{ receipt, valuesBefore, valuesAfter }, valuesAfter.map((val, i) => val.sub(valuesBefore[i]))]
  }
})
