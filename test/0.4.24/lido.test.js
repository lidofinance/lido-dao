const { artifacts, contract, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { hash } = require('eth-ens-namehash')

const { getInstalledApp } = require('@aragon/contract-helpers-test/src/aragon-os')
const { bn } = require('@aragon/contract-helpers-test')
const {
  waitBlocks,
  EvmSnapshot,
  advanceChainTime,
  getCurrentBlockTimestamp,
  setBalance,
} = require('../helpers/blockchain')
const { hexConcat, pad, ETH, tokens, div15, StETH, shares, prepIdsCountsPayload } = require('../helpers/utils')

const nodeOperators = require('../helpers/node-operators')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { pushOracleReport } = require('../helpers/oracle')
const { SECONDS_PER_FRAME, INITIAL_HOLDER, MAX_UINT256, ZERO_ADDRESS } = require('../helpers/constants')
const { oracleReportSanityCheckerStubFactory } = require('../helpers/factories')
const { newApp } = require('../helpers/dao')

const ERC20Mock = artifacts.require('ERC20Mock.sol')
const AragonVaultMock = artifacts.require('AragonVaultMock.sol')
const ERC20WrongTransferMock = artifacts.require('ERC20WrongTransferMock.sol')
const WithdrawalVault = artifacts.require('WithdrawalVault.sol')
const LidoMock = artifacts.require('LidoMock')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const UNLIMITED = 1000000000
const TOTAL_BASIS_POINTS = 10000

// Divides a BN by 1e15
const MAX_DEPOSITS = 150
const CURATED_MODULE_ID = 1
const CALLDATA = '0x0'

contract('Lido', ([appManager, , , , , , , , , , , , user1, user2, user3, nobody, depositor, treasury]) => {
  let app, oracle, depositContract, operators
  let treasuryAddress
  let dao
  let elRewardsVault
  let stakingRouter
  let anyToken, badToken
  let eip712StETH
  let lidoLocator
  let snapshot
  let consensus
  let voting

  before('deploy base app', async () => {
    anyToken = await ERC20Mock.new()
    badToken = await ERC20WrongTransferMock.new()

    const deployed = await deployProtocol({
      oracleReportSanityCheckerFactory: oracleReportSanityCheckerStubFactory,
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)

        await protocol.acl.grantPermission(
          protocol.stakingRouter.address,
          curatedModule.address,
          await curatedModule.MANAGE_NODE_OPERATOR_ROLE()
        )
        await protocol.acl.grantPermission(
          protocol.voting.address,
          curatedModule.address,
          await curatedModule.MANAGE_NODE_OPERATOR_ROLE()
        )

        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    dao = deployed.dao
    app = deployed.pool
    elRewardsVault = deployed.elRewardsVault
    eip712StETH = deployed.eip712StETH
    treasuryAddress = deployed.treasury.address
    depositContract = deployed.depositContract
    stakingRouter = deployed.stakingRouter
    operators = deployed.stakingModules[0]
    lidoLocator = deployed.lidoLocator
    oracle = deployed.oracle
    consensus = deployed.consensusContract
    voting = deployed.voting.address

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  const pushReport = async (clValidators, clBalance) => {
    const elRewardsVaultBalance = await web3.eth.getBalance(elRewardsVault.address)
    await pushOracleReport(consensus, oracle, clValidators, clBalance, elRewardsVaultBalance)
    await advanceChainTime(SECONDS_PER_FRAME + 1000)
  }

  const checkStat = async ({ depositedValidators, beaconValidators, beaconBalance }) => {
    const stat = await app.getBeaconStat()
    assert.equals(stat.depositedValidators, depositedValidators, 'depositedValidators check')
    assert.equals(stat.beaconValidators, beaconValidators, 'beaconValidators check')
    assert.equals(stat.beaconBalance, beaconBalance, 'beaconBalance check')
  }

  // Assert reward distribution. The values must be divided by 1e15.
  const checkRewards = async ({ treasury, operator }) => {
    const [treasury_b, operators_b, a1, a2, a3, a4] = await Promise.all([
      app.balanceOf(treasuryAddress),
      app.balanceOf(operators.address),
      app.balanceOf(ADDRESS_1),
      app.balanceOf(ADDRESS_2),
      app.balanceOf(ADDRESS_3),
      app.balanceOf(ADDRESS_4),
    ])

    assert.equals(div15(treasury_b), treasury, 'treasury token balance check')
    assert.equals(div15(operators_b.add(a1).add(a2).add(a3).add(a4)), operator, 'node operators token balance check')
  }

  const setupNodeOperatorsForELRewardsVaultTests = async (userAddress, initialDepositAmount) => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    const [curated] = await stakingRouter.getStakingModules()

    await web3.eth.sendTransaction({ to: app.address, from: userAddress, value: initialDepositAmount })

    // deposit(maxDeposits, stakingModuleId, calldata)
    await app.methods[`deposit(uint256,uint256,bytes)`](MAX_DEPOSITS, curated.id, CALLDATA, { from: depositor })
  }

  describe('finalizeUpgrade_v2()', () => {
    let appBase
    beforeEach(async () => {
      // contract initialize with version == 2, so reset version
      await app.setVersion(0)
      await app.resetEip712StETH()

      appBase = await LidoMock.new()
    })

    it('reverts if not initialized', async () => {
      const proxyAddress = await newApp(dao, 'lido-pool', appBase.address, appManager.address)
      const appProxy = await LidoMock.at(proxyAddress)
      await assert.reverts(appProxy.finalizeUpgrade_v2(lidoLocator.address, eip712StETH.address), 'NOT_INITIALIZED')
    })

    it('reverts with UNEXPECTED_CONTRACT_VERSION on implementation finalization', async () => {
      await assert.reverts(
        appBase.finalizeUpgrade_v2(lidoLocator.address, eip712StETH.address),
        'UNEXPECTED_CONTRACT_VERSION'
      )
    })

    it('reverts if already initialized', async () => {
      assert.equal(await app.getContractVersion(), 0)
      await app.finalizeUpgrade_v2(lidoLocator.address, eip712StETH.address)
      assert.equal(await app.getContractVersion(), 2)
      await assert.reverts(
        app.finalizeUpgrade_v2(lidoLocator.address, eip712StETH.address),
        'UNEXPECTED_CONTRACT_VERSION'
      )
    })

    it('reverts if lido locator address is ZERO', async () => {
      await assert.reverts(app.finalizeUpgrade_v2(ZERO_ADDRESS, eip712StETH.address), 'LIDO_LOCATOR_ZERO_ADDRESS')
    })

    it('reverts if eip712StETH address is ZERO', async () => {
      await assert.reverts(app.finalizeUpgrade_v2(lidoLocator.address, ZERO_ADDRESS), 'EIP712_STETH_ZERO_ADDRESS')
    })
  })

  context('EL Rewards', async () => {
    beforeEach('set up limits', async () => {
      // TODO(DZhon): revive
      // const maxPositiveTokenRebase = bn(1).mul(bn(10).pow(bn(8))) // 10%
      // await assert.reverts(app.setMaxPositiveTokenRebase(maxPositiveTokenRebase), 'APP_AUTH_FAILED')
      // const receipt = await app.setMaxPositiveTokenRebase(maxPositiveTokenRebase, { from: voting })
      // assert.emits(receipt, 'MaxPositiveTokenRebaseSet', {  maxPositiveTokenRebase: maxPositiveTokenRebase } })
    })

    it('Execution layer rewards distribution works when zero cl rewards reported', async () => {
      const clRewards = 0
      const initialDeposit = 1
      const user2Deposit = 31
      const totalDeposit = initialDeposit + user2Deposit
      const totalElRewards = totalDeposit / TOTAL_BASIS_POINTS
      const user2Rewards = user2Deposit / TOTAL_BASIS_POINTS

      await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(user2Deposit))
      await pushReport(1, ETH(totalDeposit))
      await setBalance(elRewardsVault.address, ETH(totalElRewards))

      await pushReport(1, ETH(totalDeposit + clRewards))

      assert.equals(await app.getTotalPooledEther(), ETH(initialDeposit + user2Deposit + totalElRewards + clRewards))
      assert.equals(await app.totalSupply(), StETH(initialDeposit + user2Deposit + totalElRewards + clRewards))
      assert.equals(await app.balanceOf(user2), StETH(user2Deposit + user2Rewards))
      assert.equals(await app.getTotalELRewardsCollected(), ETH(totalElRewards))
    })

    it('Execution layer rewards distribution works when negative cl rewards reported', async () => {
      const clRewards = -2
      const initialDeposit = 1
      const user2Deposit = 31
      const totalDeposit = initialDeposit + user2Deposit
      const totalElRewards = totalDeposit / TOTAL_BASIS_POINTS
      const user2Rewards = user2Deposit / TOTAL_BASIS_POINTS

      await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(user2Deposit))
      await pushReport(1, ETH(totalDeposit))

      await setBalance(elRewardsVault.address, ETH(totalElRewards))
      await pushReport(1, ETH(totalDeposit + clRewards))

      assert.equals(await app.getTotalPooledEther(), ETH(initialDeposit + user2Deposit + totalElRewards + clRewards))
      assert.equals(await app.balanceOf(user2), StETH(user2Deposit + user2Rewards + (clRewards * 31) / 32))
      assert.equals(await app.getTotalELRewardsCollected(), ETH(totalElRewards))
    })

    it('Execution layer rewards distribution works when positive cl rewards reported', async () => {
      const clRewards = 3
      const initialDeposit = 1
      const user2Deposit = 31
      const totalDeposit = initialDeposit + user2Deposit
      const totalElRewards = totalDeposit / TOTAL_BASIS_POINTS

      await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(user2Deposit))
      await pushReport(1, ETH(totalDeposit))

      await setBalance(elRewardsVault.address, ETH(totalElRewards))
      await pushReport(1, ETH(totalDeposit + clRewards))

      assert.equals(await app.getTotalPooledEther(), ETH(totalDeposit + totalElRewards + clRewards))
      assert.equals(await app.getTotalELRewardsCollected(), ETH(totalElRewards))

      const fee = await app.getFee()

      const stakersReward = ((totalElRewards + clRewards) * (TOTAL_BASIS_POINTS - fee)) / TOTAL_BASIS_POINTS

      assert.equals(await app.balanceOf(user2), StETH(user2Deposit + (stakersReward * 31) / 32))
    })

    it('Attempt to set invalid execution layer rewards withdrawal limit', async () => {
      // TODO: revive
      // const initialValue = await app.getMaxPositiveTokenRebase()

      // assert.emits(await app.setMaxPositiveTokenRebase(1, { from: voting }), 'MaxPositiveTokenRebaseSet', {
      //   maxPositiveTokenRebase: 1 }

      const setupNodeOperatorsForELRewardsVaultTests = async (userAddress, initialDepositAmount) => {
        await app.setFee(1000, { from: voting }) // 10%

        await web3.eth.sendTransaction({ to: app.address, from: userAddress, value: initialDepositAmount })

        const withdrawal = await WithdrawalVault.new(app.address, treasury)
        await app.setWithdrawalCredentials(hexConcat('0x01', pad(withdrawal.address, 31)), { from: voting })

        await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
        await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

        await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
        await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

        await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
        await operators.addSigningKeys(
          0,
          3,
          hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
          hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
          { from: voting }
        )

        await app.methods['depositBufferedEther()']({ from: depositor })
      }

      it('Execution layer rewards distribution works when zero rewards reported', async () => {
        const depositAmount = 32
        const elRewards = depositAmount / TOTAL_BASIS_POINTS
        const beaconRewards = 0

        await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
        await pushReport(1, ETH(depositAmount))

        await setBalance(elRewardsVault.address, ETH(elRewards))
        await pushReport(1, ETH(depositAmount + beaconRewards))

        assert.equals(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
        assert.equals(await app.getBufferedEther(), ETH(elRewards))
        assert.equals(await app.balanceOf(user2), StETH(depositAmount + elRewards))
        assert.equals(await app.getTotalELRewardsCollected(), ETH(elRewards))
      })

      it('Execution layer rewards distribution works when negative rewards reported', async () => {
        const depositAmount = 32
        const elRewards = depositAmount / TOTAL_BASIS_POINTS
        const beaconRewards = -2

        await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
        await pushReport(1, ETH(depositAmount))

        await setBalance(elRewardsVault.address, ETH(elRewards))
        await pushReport(1, ETH(depositAmount + beaconRewards))

        assert.equals(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
        assert.equals(await app.getBufferedEther(), ETH(elRewards))
        assert.equals(await app.balanceOf(user2), StETH(depositAmount + elRewards + beaconRewards))
        assert.equals(await app.getTotalELRewardsCollected(), ETH(elRewards))
      })

      it('Execution layer rewards distribution works when positive rewards reported', async () => {
        const depositAmount = 32
        const elRewards = depositAmount / TOTAL_BASIS_POINTS
        const beaconRewards = 3

        await setupNodeOperatorsForELRewardsVaultTests(user2, ETH(depositAmount))
        await pushReport(1, ETH(depositAmount))

        await setBalance(elRewardsVault.address, ETH(elRewards))
        await pushReport(1, ETH(depositAmount + beaconRewards))

        const { totalFee } = await app.getFee()
        const shareOfRewardsForStakers = (TOTAL_BASIS_POINTS - totalFee) / TOTAL_BASIS_POINTS
        assert.equals(await app.getTotalPooledEther(), ETH(depositAmount + elRewards + beaconRewards))
        assert.equals(await app.getBufferedEther(), ETH(elRewards))
        assert.equals(
          await app.balanceOf(user2),
          StETH(depositAmount + shareOfRewardsForStakers * (elRewards + beaconRewards))
        )
        assert.equals(await app.getTotalELRewardsCollected(), ETH(elRewards))
      })

      it('Attempt to set invalid execution layer rewards withdrawal limit', async () => {
        const initialValue = await app.getELRewardsWithdrawalLimit()

        assert.emits(await app.setELRewardsWithdrawalLimit(1, { from: voting }), 'ELRewardsWithdrawalLimitSet', {
          limitPoints: 1,
        })

        assert.notEmits(await app.setELRewardsWithdrawalLimit(1, { from: voting }), 'ELRewardsWithdrawalLimitSet')

        await app.setELRewardsWithdrawalLimit(10000, { from: voting })
        await assert.reverts(app.setELRewardsWithdrawalLimit(10001, { from: voting }), 'VALUE_OVER_100_PERCENT')

        await app.setELRewardsWithdrawalLimit(initialValue, { from: voting })

        // unable to receive execution layer rewards from arbitrary account
        await assert.reverts(app.receiveELRewards({ from: user1, value: ETH(1) }))
      })
    })
  })

  describe('receiveELRewards()', async () => {
    it('unable to receive eth from arbitrary account', async () => {
      await assert.reverts(app.receiveELRewards({ from: nobody, value: ETH(1) }))
    })

    it('event work', async () => {
      await ethers.provider.send('hardhat_impersonateAccount', [elRewardsVault.address])
      await setBalance(elRewardsVault.address, ETH(100))

      const receipt = await app.receiveELRewards({ from: elRewardsVault.address, value: ETH(2) })

      assert.emits(receipt, 'ELRewardsReceived', { amount: ETH(2) })

      assert.equals(await app.getTotalELRewardsCollected(), ETH(2))
    })
  })

  it('setWithdrawalCredentials works', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await assert.reverts(
      stakingRouter.setWithdrawalCredentials(pad('0x0203', 32), { from: user1 }),
      `AccessControl: account ${user1.toLowerCase()} is missing role ${await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE()}`
    )

    assert.equal(await stakingRouter.getWithdrawalCredentials(), pad('0x0202', 32))
    assert.equal(await app.getWithdrawalCredentials(), pad('0x0202', 32))
  })

  it('setWithdrawalCredentials resets unused keys', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      1,
      2,
      hexConcat(pad('0x050505', 48), pad('0x060606', 48)),
      hexConcat(pad('0x02', 96), pad('0x03', 96)),
      {
        from: voting,
      }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 2)

    await stakingRouter.setWithdrawalCredentials(pad('0x0203', 32), { from: voting })

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 0)
    assert.equal(await app.getWithdrawalCredentials({ from: nobody }), pad('0x0203', 32))
  })

  it('Lido.deposit(uint256,uint256,bytes) reverts when called by account without DEPOSIT_ROLE granted', async () => {
    await assert.reverts(
      app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: nobody }),
      'APP_AUTH_DSM_FAILED'
    )
  })

  it('deposit works', async () => {
    await stakingRouter.setWithdrawalCredentials('0x00', { from: voting })

    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // zero deposits revert
    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user1, value: ETH(0) }), 'ZERO_DEPOSIT')
    await assert.reverts(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(0) }), 'ZERO_DEPOSIT')

    // Initial balance (1 ETH)
    assert.equals(await app.getTotalPooledEther(), ETH(1))
    assert.equals(await app.getBufferedEther(), ETH(1))
    assert.equals(await app.balanceOf(INITIAL_HOLDER), tokens(1))
    assert.equals(await app.totalSupply(), tokens(1))

    // +1 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    // can not deposit with unset withdrawalCredentials even with O ETH deposit
    await assert.reverts(
      app.deposit(MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor }),
      'EmptyWithdrawalsCredentials()'
    )
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await depositContract.totalCalls(), 0)
    assert.equals(await app.getTotalPooledEther(), ETH(2))
    assert.equals(await app.getBufferedEther(), ETH(2))
    assert.equals(await app.getTotalELRewardsCollected(), 0)
    assert.equals(await app.balanceOf(user1), tokens(1))
    assert.equals(await app.totalSupply(), tokens(2))

    // +2 ETH
    const receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }) // another form of a deposit call

    assert.emits(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user2, value: ETH(2) })

    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await depositContract.totalCalls(), 0)
    assert.equals(await app.getTotalPooledEther(), ETH(4))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(await app.getTotalELRewardsCollected(), 0)
    assert.equals(await app.balanceOf(user2), tokens(2))
    assert.equals(await app.totalSupply(), tokens(4))

    // +30 ETH
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(30) })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    // can not deposit with unset withdrawalCredentials
    await assert.revertsWithCustomError(
      app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor }),
      'EmptyWithdrawalsCredentials()'
    )
    // set withdrawalCredentials with keys, because they were trimmed
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    assert.equals(
      await stakingRouter.getStakingModuleMaxDepositsCount(CURATED_MODULE_ID, await app.getDepositableEther()),
      0
    )

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    assert.equals(
      await stakingRouter.getStakingModuleMaxDepositsCount(CURATED_MODULE_ID, await app.getDepositableEther()),
      1
    )
    assert.equals(await app.getTotalPooledEther(), ETH(34))
    assert.equals(await app.getBufferedEther(), ETH(34))

    // now deposit works
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(34))
    assert.equals(await app.getBufferedEther(), ETH(2))
    assert.equals(await app.balanceOf(user1), tokens(1))
    assert.equals(await app.balanceOf(user2), tokens(2))
    assert.equals(await app.balanceOf(user3), tokens(30))
    assert.equals(await app.totalSupply(), tokens(34))

    assert.equals(await depositContract.totalCalls(), 1)
    const c0 = await depositContract.calls.call(0)
    assert.equal(c0.pubkey, pad('0x010203', 48))
    assert.equal(c0.withdrawal_credentials, pad('0x0202', 32))
    assert.equal(c0.signature, pad('0x01', 96))
    assert.equals(c0.value, ETH(32))

    // +100 ETH, test partial unbuffering
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(100) })
    await app.deposit(1, 1, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 2, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(134))
    assert.equals(await app.getBufferedEther(), ETH(70))
    assert.equals(await app.balanceOf(user1), tokens(101))
    assert.equals(await app.balanceOf(user2), tokens(2))
    assert.equals(await app.balanceOf(user3), tokens(30))
    assert.equals(await app.totalSupply(), tokens(134))

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(134))
    assert.equals(await app.getBufferedEther(), ETH(6))
    assert.equals(await app.balanceOf(user1), tokens(101))
    assert.equals(await app.balanceOf(user2), tokens(2))
    assert.equals(await app.balanceOf(user3), tokens(30))
    assert.equals(await app.totalSupply(), tokens(134))

    assert.equals(await depositContract.totalCalls(), 4)
    const calls = {}
    for (const i of [1, 2, 3]) {
      calls[i] = await depositContract.calls.call(i)
      assert.equal(calls[i].withdrawal_credentials, pad('0x0202', 32))
      assert.equal(calls[i].signature, pad('0x01', 96))
      assert.equals(calls[i].value, ETH(32))
    }
    assert.equal(calls[1].pubkey, pad('0x010204', 48))
    assert.equal(calls[2].pubkey, pad('0x010205', 48))
    assert.equal(calls[3].pubkey, pad('0x010206', 48))
  })

  it('deposit uses the expected signing keys', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    const op0 = {
      keys: Array.from({ length: 3 }, (_, i) => `0x11${i}${i}` + 'abcd'.repeat(46 / 2)),
      sigs: Array.from({ length: 3 }, (_, i) => `0x11${i}${i}` + 'cdef'.repeat(94 / 2)),
    }

    const op1 = {
      keys: Array.from({ length: 3 }, (_, i) => `0x22${i}${i}` + 'efab'.repeat(46 / 2)),
      sigs: Array.from({ length: 3 }, (_, i) => `0x22${i}${i}` + 'fcde'.repeat(94 / 2)),
    }

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 3, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: voting })
    await operators.addSigningKeys(1, 3, hexConcat(...op1.keys), hexConcat(...op1.sigs), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 1, 'first submit: total deposits')

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2 * 32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 3, 'second submit: total deposits')

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(3 * 32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 6, 'third submit: total deposits')

    const calls = await Promise.all(Array.from({ length: 6 }, (_, i) => depositContract.calls(i)))
    const keys = [...op0.keys, ...op1.keys]
    const sigs = [...op0.sigs, ...op1.sigs]
    const pairs = keys.map((key, i) => `${key}|${sigs[i]}`)

    assert.sameMembers(
      calls.map((c) => `${c.pubkey}|${c.signature}`),
      pairs,
      'pairs'
    )
  })

  it('deposit works when the first node operator is inactive', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(1, 1, pad('0x030405', 48), pad('0x06', 96), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await operators.deactivateNodeOperator(0, { from: voting })
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 1)
  })

  it('submits with zero and non-zero referrals work', async () => {
    const REFERRAL = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
    let receipt
    receipt = await app.submit(REFERRAL, { from: user2, value: ETH(2) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(2), referral: REFERRAL })
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(5) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS })
  })

  const verifyStakeLimitState = async (
    expectedMaxStakeLimit,
    expectedLimitIncrease,
    expectedCurrentStakeLimit,
    expectedIsStakingPaused,
    expectedIsStakingLimited
  ) => {
    assert.equals(await app.getCurrentStakeLimit(), expectedCurrentStakeLimit)

    assert.equal(await app.isStakingPaused(), expectedIsStakingPaused)
    const { isStakingPaused, isStakingLimitSet, currentStakeLimit, maxStakeLimit, maxStakeLimitGrowthBlocks } =
      await app.getStakeLimitFullInfo()

    assert.equals(currentStakeLimit, expectedCurrentStakeLimit)
    assert.equals(maxStakeLimit, expectedMaxStakeLimit)
    assert.equal(isStakingPaused, expectedIsStakingPaused)
    assert.equal(isStakingLimitSet, expectedIsStakingLimited)

    if (isStakingLimitSet) {
      assert.equals(
        maxStakeLimitGrowthBlocks,
        expectedLimitIncrease > 0 ? expectedMaxStakeLimit / expectedLimitIncrease : 0
      )
    }
  }

  it('staking pause & unlimited resume works', async () => {
    assert.equals(await app.isStakingPaused(), false)

    let receipt

    await verifyStakeLimitState(0, 0, bn(MAX_UINT256), false, false)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS })

    await assert.reverts(app.pauseStaking(), 'APP_AUTH_FAILED')
    receipt = await app.pauseStaking({ from: voting })
    assert.emits(receipt, 'StakingPaused')
    await verifyStakeLimitState(0, 0, 0, true, false)

    await assert.reverts(web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(2) }), `STAKING_PAUSED`)
    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) }), `STAKING_PAUSED`)

    await assert.reverts(app.resumeStaking(), 'APP_AUTH_FAILED')
    receipt = await app.resumeStaking({ from: voting })
    assert.emits(receipt, 'StakingResumed')
    await verifyStakeLimitState(0, 0, bn(MAX_UINT256), false, false)

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(1.1) })
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(1.4) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(1.4), referral: ZERO_ADDRESS })
  })

  it('staking resume with a limit works', async () => {
    let receipt

    const blocksToReachMaxStakeLimit = 300
    const expectedMaxStakeLimit = ETH(3)
    const limitIncreasePerBlock = bn(expectedMaxStakeLimit).div(bn(blocksToReachMaxStakeLimit)) // 1 * 10**16

    receipt = await app.resumeStaking({ from: voting })
    assert.emits(receipt, 'StakingResumed')

    await assert.reverts(app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock), 'APP_AUTH_FAILED')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assert.emits(receipt, 'StakingLimitSet', {
      maxStakeLimit: expectedMaxStakeLimit,
      stakeLimitIncreasePerBlock: limitIncreasePerBlock,
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(1), false, true)
    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.5) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(
      expectedMaxStakeLimit,
      limitIncreasePerBlock,
      bn(ETH(1)).add(limitIncreasePerBlock),
      false,
      true
    )

    // expect to grow for another 1.5 ETH since last submit
    // every revert produces new block, so we need to account that block
    await waitBlocks(blocksToReachMaxStakeLimit / 2 - 1)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(2.5), false, true)
    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.6) }), `STAKE_LIMIT`)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2.5) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(2.5), referral: ZERO_ADDRESS })
    await verifyStakeLimitState(
      expectedMaxStakeLimit,
      limitIncreasePerBlock,
      limitIncreasePerBlock.muln(2),
      false,
      true
    )

    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(0.1) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(
      expectedMaxStakeLimit,
      limitIncreasePerBlock,
      limitIncreasePerBlock.muln(3),
      false,
      true
    )
    // once again, we are subtracting blocks number induced by revert checks
    await waitBlocks(blocksToReachMaxStakeLimit / 3 - 4)

    receipt = await app.submit(ZERO_ADDRESS, { from: user1, value: ETH(1) })
    assert.emits(receipt, 'Submitted', { sender: user1, amount: ETH(1), referral: ZERO_ADDRESS })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)

    // check that limit is restored completely
    await waitBlocks(blocksToReachMaxStakeLimit)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    // check that limit is capped by maxLimit value and doesn't grow infinitely
    await waitBlocks(10)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    await assert.reverts(app.setStakingLimit(ETH(0), ETH(0), { from: voting }), `ZERO_MAX_STAKE_LIMIT`)
    await assert.reverts(app.setStakingLimit(ETH(1), ETH(1.1), { from: voting }), `TOO_LARGE_LIMIT_INCREASE`)
    await assert.reverts(app.setStakingLimit(ETH(1), bn(10), { from: voting }), `TOO_SMALL_LIMIT_INCREASE`)
  })

  it('resume staking with an one-shot limit works', async () => {
    let receipt

    const expectedMaxStakeLimit = ETH(7)
    const limitIncreasePerBlock = 0

    receipt = await app.resumeStaking({ from: voting })
    assert.emits(receipt, 'StakingResumed')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assert.emits(receipt, 'StakingLimitSet', {
      maxStakeLimit: expectedMaxStakeLimit,
      stakeLimitIncreasePerBlock: limitIncreasePerBlock,
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(5) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(5), referral: ZERO_ADDRESS })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(2), false, true)
    receipt = await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(2) })
    assert.emits(receipt, 'Submitted', { sender: user2, amount: ETH(2), referral: ZERO_ADDRESS })
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
    await assert.reverts(app.submit(ZERO_ADDRESS, { from: user2, value: ETH(0.1) }), `STAKE_LIMIT`)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
    await waitBlocks(100)
    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, ETH(0), false, true)
  })

  it('resume staking with various changing limits work', async () => {
    let receipt

    const expectedMaxStakeLimit = ETH(9)
    const limitIncreasePerBlock = bn(expectedMaxStakeLimit).divn(100)

    receipt = await app.resumeStaking({ from: voting })
    assert.emits(receipt, 'StakingResumed')
    receipt = await app.setStakingLimit(expectedMaxStakeLimit, limitIncreasePerBlock, { from: voting })
    assert.emits(receipt, 'StakingLimitSet', {
      maxStakeLimit: expectedMaxStakeLimit,
      stakeLimitIncreasePerBlock: limitIncreasePerBlock,
    })

    await verifyStakeLimitState(expectedMaxStakeLimit, limitIncreasePerBlock, expectedMaxStakeLimit, false, true)

    const smallerExpectedMaxStakeLimit = ETH(5)
    const smallerLimitIncreasePerBlock = bn(smallerExpectedMaxStakeLimit).divn(200)

    receipt = await app.setStakingLimit(smallerExpectedMaxStakeLimit, smallerLimitIncreasePerBlock, { from: voting })
    assert.emits(receipt, 'StakingLimitSet', {
      maxStakeLimit: smallerExpectedMaxStakeLimit,
      stakeLimitIncreasePerBlock: smallerLimitIncreasePerBlock,
    })

    await verifyStakeLimitState(
      smallerExpectedMaxStakeLimit,
      smallerLimitIncreasePerBlock,
      smallerExpectedMaxStakeLimit,
      false,
      true
    )

    const largerExpectedMaxStakeLimit = ETH(10)
    const largerLimitIncreasePerBlock = bn(largerExpectedMaxStakeLimit).divn(1000)

    receipt = await app.setStakingLimit(largerExpectedMaxStakeLimit, largerLimitIncreasePerBlock, { from: voting })
    assert.emits(receipt, 'StakingLimitSet', {
      maxStakeLimit: largerExpectedMaxStakeLimit,
      stakeLimitIncreasePerBlock: largerLimitIncreasePerBlock,
    })

    await verifyStakeLimitState(
      largerExpectedMaxStakeLimit,
      largerLimitIncreasePerBlock,
      smallerExpectedMaxStakeLimit,
      false,
      true
    )

    await assert.reverts(app.removeStakingLimit(), 'APP_AUTH_FAILED')
    receipt = await app.removeStakingLimit({ from: voting })
    assert.emits(receipt, 'StakingLimitRemoved')

    await verifyStakeLimitState(0, 0, bn(2).pow(bn(256)).sub(bn(1)), false, false)
  })

  it('reverts when trying to call unknown function', async () => {
    const wrongMethodABI = '0x00'
    await assert.reverts(
      web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(1), data: wrongMethodABI }),
      'NON_EMPTY_DATA'
    )
    await assert.reverts(
      web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(0), data: wrongMethodABI }),
      'NON_EMPTY_DATA'
    )
  })

  it('key removal is taken into account during deposit', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(33) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 1)
    await assert.reverts(operators.removeSigningKey(0, 0, { from: voting }), 'OUT_OF_RANGE')

    assert.equals(await app.getBufferedEther(), ETH(2))

    await operators.removeSigningKey(0, 1, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(100) })

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(134))
    assert.equals(await app.getBufferedEther(), ETH(102))
  })

  it("out of signing keys doesn't revert but buffers", async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(99) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(100))
    assert.equals(await app.getBufferedEther(), ETH(100 - 32))

    // buffer unwinds
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    // increase staking limit
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(1) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await depositContract.totalCalls(), 3)
    assert.equals(await app.getTotalPooledEther(), ETH(101))
    assert.equals(await app.getBufferedEther(), ETH(5))
  })

  it('handleOracleReport works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(34) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })

    await assert.reverts(
      app.handleOracleReport(await getCurrentBlockTimestamp(), 1, ETH(30), 0, 0, 0, 0, [], 0, { from: appManager }),
      'APP_AUTH_FAILED'
    )

    await pushReport(1, ETH(30))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })

    await assert.reverts(
      app.handleOracleReport(await getCurrentBlockTimestamp(), 1, ETH(29), 0, 0, 0, 0, [], 0, { from: nobody }),
      'APP_AUTH_FAILED'
    )

    await pushReport(1, ETH(100)) // stale data
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(100) })

    await pushReport(1, ETH(33))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(33) })
  })

  it('oracle data affects deposits', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(33) })
    const withdrawal = await WithdrawalVault.new(app.address, treasury)
    const withdrawalCredentials = hexConcat('0x01', pad(withdrawal.address, 31))
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(34))
    assert.equals(await app.getBufferedEther(), ETH(2))

    // down
    await pushReport(1, ETH(15))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(17))
    assert.equals(await app.getBufferedEther(), ETH(2))
    assert.equals(await app.totalSupply(), tokens(17))

    // deposit, ratio is 0.5
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(2) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(15) })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(19))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(await app.balanceOf(user1), tokens(2))
    assert.equals(await app.totalSupply(), tokens(19))

    // up
    await assert.reverts(pushReport(2, ETH(48)), 'REPORTED_MORE_DEPOSITED')
    await pushReport(1, ETH(48))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(48) })
    assert.equals(await depositContract.totalCalls(), 1)
    assert.equals(await app.getTotalPooledEther(), ETH(52))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(await app.totalSupply(), tokens(52))
  })

  it('can stop and resume', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(40) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getBufferedEther(), ETH(9))

    await assert.reverts(app.stop({ from: user2 }), 'APP_AUTH_FAILED')
    await app.stop({ from: voting })
    assert((await app.isStakingPaused()) === true)

    await assert.reverts(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'STAKING_PAUSED')
    await assert.reverts(web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) }), 'STAKING_PAUSED')
    await assert.reverts(
      app.submit('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', { from: user1, value: ETH(4) }),
      'STAKING_PAUSED'
    )

    await assert.reverts(app.resume({ from: user2 }), 'APP_AUTH_FAILED')
    await app.resume({ from: voting })
    assert((await app.isStakingPaused()) === false)

    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(4) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 1, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getBufferedEther(), ETH(13))
  })

  it('rewards distribution on module with zero treasury and module fee', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // get staking module
    const [curated] = await stakingRouter.getStakingModules()

    let module1 = await stakingRouter.getStakingModule(curated.id)
    assert.equals(module1.targetShare, 10000)
    assert.equals(module1.stakingModuleFee, 500)
    assert.equals(module1.treasuryFee, 500)

    // stakingModuleId, targetShare, stakingModuleFee, treasuryFee
    await stakingRouter.updateStakingModule(module1.id, module1.targetShare, 0, 0, { from: voting })

    module1 = await stakingRouter.getStakingModule(curated.id)
    assert.equals(module1.targetShare, 10000)
    assert.equals(module1.stakingModuleFee, 0)
    assert.equals(module1.treasuryFee, 0)

    // check stat before deposit
    await checkStat({ depositedValidators: 0, beaconValidators: 0, beaconBalance: 0 })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(33) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await pushReport(1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assert.equals(await app.totalSupply(), ETH(38)) // remote + buffered
    await checkRewards({ treasury: 0, operator: 0 })

    // return module commission
    await stakingRouter.updateStakingModule(module1.id, module1.targetShare, 500, 500, { from: voting })

    //
    await pushReport(1, ETH(38))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(38) })
    assert.equals(await app.totalSupply(), ETH(40)) // remote + buffered
    await checkRewards({ treasury: 100, operator: 99 })
  })

  it('rewards distribution works in a simple case', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(33) })
    const withdrawal = await WithdrawalVault.new(app.address, treasury)
    await stakingRouter.setWithdrawalCredentials(hexConcat('0x01', pad(withdrawal.address, 31)), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await pushReport(1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assert.equals(await app.totalSupply(), ETH(38)) // remote + buffered
    await checkRewards({ treasury: 199, operator: 199 })
  })

  it('rewards distribution works', async () => {
    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(33) })
    const withdrawal = await WithdrawalVault.new(app.address, treasury)
    await stakingRouter.setWithdrawalCredentials(hexConcat('0x01', pad(withdrawal.address, 31)), { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.addSigningKeys(
      0,
      3,
      hexConcat(pad('0x010204', 48), pad('0x010205', 48), pad('0x010206', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96), pad('0x01', 96)),
      { from: voting }
    )

    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    // some slashing occurred
    await pushReport(1, ETH(30))

    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(30) })
    // ToDo check buffer=2
    assert.equals(await app.totalSupply(), tokens(32)) // 30 remote (slashed) + 2 buffered = 32
    await checkRewards({ treasury: 0, operator: 0 })

    // rewarded 200 Ether (was 30, became 230)
    await pushReport(1, ETH(130))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(130) })
    // Todo check reward effects
    // await checkRewards({ treasury: 0, operator: 0 })

    await pushReport(1, ETH(2230))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(2230) })
    assert.equals(await app.totalSupply(), tokens(2232))
    // Todo check reward effects
    // await checkRewards({ treasury: tokens(33), operator: tokens(55) })
  })

  it('deposits accounted properly during rewards distribution', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('1', ADDRESS_1, { from: voting })
    await operators.addNodeOperator('2', ADDRESS_2, { from: voting })
    await operators.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    // Only 32 ETH deposited (we have initial 1 ETH)
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(31) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    assert.equals(await app.totalSupply(), StETH(64))

    await pushReport(1, ETH(36))
    await checkStat({ depositedValidators: 1, beaconValidators: 1, beaconBalance: ETH(36) })
    assert.equals(await app.totalSupply(), StETH(68))
    await checkRewards({ treasury: 200, operator: 199 })
  })

  it('Node Operators filtering during deposit works when doing a huge deposit', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, totalSigningKeysCount: 2, vettedSigningKeysCount: 2 },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, totalSigningKeysCount: 2, vettedSigningKeysCount: 1 },
      { from: voting }
    )

    // id: 2
    await nodeOperators.addNodeOperator(
      operators,
      {
        name: 'deactivated',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 2,
        vettedSigningKeysCount: 2,
        isActive: false,
      },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4 },
      { from: voting }
    )

    // Deposit huge chunk
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(32 * 3 + 49) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(146))
    assert.equals(await app.getBufferedEther(), ETH(50))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(178))
    assert.equals(await app.getBufferedEther(), ETH(82))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit
    const { operatorIds, keysCounts } = prepIdsCountsPayload(1, 1)
    await operators.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(179))
    assert.equals(await app.getBufferedEther(), ETH(83))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(180))
    assert.equals(await app.getBufferedEther(), ETH(52))
    assert.equals(await depositContract.totalCalls(), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 doesn't change anything cause keys of #2 was trimmed
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(192))
    assert.equals(await app.getBufferedEther(), ETH(64))
    assert.equals(await depositContract.totalCalls(), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Node Operators filtering during deposit works when doing small deposits', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    // id: 0
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'good', rewardAddress: ADDRESS_1, totalSigningKeysCount: 2, vettedSigningKeysCount: 2 },
      { from: voting }
    )

    // id: 1
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'limited', rewardAddress: ADDRESS_2, totalSigningKeysCount: 2, vettedSigningKeysCount: 1 },
      { from: voting }
    )

    // id: 2
    await nodeOperators.addNodeOperator(
      operators,
      {
        name: 'deactivated',
        rewardAddress: ADDRESS_3,
        totalSigningKeysCount: 2,
        vettedSigningKeysCount: 2,
        isActive: false,
      },
      { from: voting }
    )

    // id: 3
    await nodeOperators.addNodeOperator(
      operators,
      { name: 'short on keys', rewardAddress: ADDRESS_4 },
      { from: voting }
    )

    // Small deposits
    for (let i = 0; i < 14; i++) await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(10) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(5) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })

    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(146))
    assert.equals(await app.getBufferedEther(), ETH(50))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Next deposit changes nothing
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(32) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(178))
    assert.equals(await app.getBufferedEther(), ETH(82))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // #1 goes below the limit (doesn't change situation. validator stop decreases limit)
    const { operatorIds, keysCounts } = prepIdsCountsPayload(1, 1)
    await operators.updateExitedValidatorsCount(operatorIds, keysCounts, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(179))
    assert.equals(await app.getBufferedEther(), ETH(83))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Adding a key & setting staking limit will help
    await operators.addSigningKeys(0, 1, pad('0x0003', 48), pad('0x01', 96), { from: voting })
    await operators.setNodeOperatorStakingLimit(0, 3, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(1) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(180))
    assert.equals(await app.getBufferedEther(), ETH(52))
    assert.equals(await depositContract.totalCalls(), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 (changes nothing, it's not used keys were trimmed)
    await operators.activateNodeOperator(2, { from: voting })
    await web3.eth.sendTransaction({ to: app.address, from: user3, value: ETH(12) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 4, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(192))
    assert.equals(await app.getBufferedEther(), ETH(64))
    assert.equals(await depositContract.totalCalls(), 4)

    assert.equals(await operators.getTotalSigningKeyCount(0, { from: nobody }), 3)
    assert.equals(await operators.getTotalSigningKeyCount(1, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getTotalSigningKeyCount(3, { from: nobody }), 0)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 0)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('Deposit finds the right operator', async () => {
    await stakingRouter.setWithdrawalCredentials(pad('0x0202', 32), { from: voting })

    await operators.addNodeOperator('good', ADDRESS_1, { from: voting }) // 0
    await operators.addSigningKeys(
      0,
      2,
      hexConcat(pad('0x0001', 48), pad('0x0002', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(0, UNLIMITED, { from: voting })

    await operators.addNodeOperator('2nd good', ADDRESS_2, { from: voting }) // 1
    await operators.addSigningKeys(
      1,
      2,
      hexConcat(pad('0x0101', 48), pad('0x0102', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(1, UNLIMITED, { from: voting })

    await operators.addNodeOperator('deactivated', ADDRESS_3, { from: voting }) // 2
    await operators.addSigningKeys(
      2,
      2,
      hexConcat(pad('0x0201', 48), pad('0x0202', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })
    await operators.deactivateNodeOperator(2, { from: voting })

    await operators.addNodeOperator('short on keys', ADDRESS_4, { from: voting }) // 3
    await operators.setNodeOperatorStakingLimit(3, UNLIMITED, { from: voting })

    // #1 and #0 get the funds
    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(63) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 2, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(64))
    assert.equals(await app.getBufferedEther(), ETH(0))
    assert.equals(await depositContract.totalCalls(), 2)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 2)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)

    // Reactivation of #2 & setting staking limit - has the smallest stake
    await operators.activateNodeOperator(2, { from: voting })
    await operators.addSigningKeys(
      2,
      2,
      hexConcat(pad('0x0201', 48), pad('0x0202', 48)),
      hexConcat(pad('0x01', 96), pad('0x01', 96)),
      {
        from: voting,
      }
    )
    await operators.setNodeOperatorStakingLimit(2, UNLIMITED, { from: voting })

    await web3.eth.sendTransaction({ to: app.address, from: user2, value: ETH(36) })
    await app.methods['deposit(uint256,uint256,bytes)'](MAX_DEPOSITS, CURATED_MODULE_ID, CALLDATA, { from: depositor })
    await checkStat({ depositedValidators: 3, beaconValidators: 0, beaconBalance: ETH(0) })
    assert.equals(await app.getTotalPooledEther(), ETH(100))
    assert.equals(await app.getBufferedEther(), ETH(4))
    assert.equals(await depositContract.totalCalls(), 3)

    assert.equals(await operators.getUnusedSigningKeyCount(0, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(1, { from: nobody }), 1)
    assert.equals(await operators.getUnusedSigningKeyCount(2, { from: nobody }), 3)
    assert.equals(await operators.getUnusedSigningKeyCount(3, { from: nobody }), 0)
  })

  it('burnShares works', async () => {
    await web3.eth.sendTransaction({ to: app.address, from: user1, value: ETH(2) }) // 4 ETH total

    // can burn shares of an arbitrary user
    const pre1SharePrice = await app.getPooledEthByShares(shares(1))
    let receipt = await app.burnShares(user1, shares(1), { from: voting })
    const post1SharePrice = await app.getPooledEthByShares(shares(1))
    assert.emits(receipt, 'SharesBurnt', {
      account: user1,
      preRebaseTokenAmount: pre1SharePrice,
      postRebaseTokenAmount: post1SharePrice,
      sharesAmount: shares(1),
    })

    const pre2SharePrice = await app.getPooledEthByShares(shares(1))
    receipt = await app.burnShares(user1, shares(1), { from: voting })
    const post2SharePrice = await app.getPooledEthByShares(shares(1))
    assert.emits(receipt, 'SharesBurnt', {
      account: user1,
      preRebaseTokenAmount: pre2SharePrice,
      postRebaseTokenAmount: post2SharePrice,
      sharesAmount: shares(1),
    })

    assert.equals(pre1SharePrice.muln(3), pre2SharePrice.muln(2))
    assert.equals(await app.getPooledEthByShares(shares(1)), ETH(3))

    // user1 has zero shares after all
    assert.equals(await app.sharesOf(user1), shares(0))

    // voting can't continue burning if user already has no shares
    await assert.reverts(app.burnShares(user1, 1, { from: voting }), 'BALANCE_EXCEEDED')
  })

  context('treasury', () => {
    it('treasury address has been set after init', async () => {
      assert.notEqual(await lidoLocator.treasury(), ZERO_ADDRESS)
    })
  })

  context('recovery vault', () => {
    beforeEach(async () => {
      await anyToken.mint(app.address, 100)
      await badToken.mint(app.address, 100)
    })

    it('reverts when vault is not set', async () => {
      await assert.reverts(app.transferToVault(anyToken.address, { from: nobody }), 'NOT_SUPPORTED')
    })

    it('reverts when recover disallowed', async () => {
      await app.setAllowRecoverability(false)
      await assert.reverts(app.transferToVault(anyToken.address, { from: nobody }), 'NOT_SUPPORTED')
    })

    context('reverts when vault is set', () => {
      let vault

      beforeEach(async () => {
        // Create a new vault and set that vault as the default vault in the kernel
        const vaultId = hash('vault.aragonpm.test')
        const vaultBase = await AragonVaultMock.new()
        const vaultReceipt = await dao.newAppInstance(vaultId, vaultBase.address, '0x', true)
        const vaultAddress = getInstalledApp(vaultReceipt)
        vault = await AragonVaultMock.at(vaultAddress)
        await vault.initialize()

        await dao.setRecoveryVaultAppId(vaultId)
      })

      it('recovery with erc20 tokens reverts', async () => {
        await assert.reverts(app.transferToVault(anyToken.address, { from: nobody }), 'NOT_SUPPORTED')
      })

      it('recovery with unaccounted ether reverts', async () => {
        await app.makeUnaccountedEther({ from: user1, value: ETH(10) })
        await assert.reverts(app.transferToVault(ZERO_ADDRESS, { from: nobody }), 'NOT_SUPPORTED')
      })
    })
  })
})
