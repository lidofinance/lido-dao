const { contract, ethers } = require('hardhat')
const { deployProtocol } = require('../helpers/protocol')
const { EvmSnapshot, setBalance, getBalance } = require('../helpers/blockchain')
const { ZERO_ADDRESS } = require('../helpers/constants')
const { assert } = require('../helpers/assert')
const { wei } = require('../helpers/wei')
const { StakingModuleStub } = require('../helpers/stubs/staking-module.stub')
const { PUBKEY_LENGTH, FakeValidatorKeys, SIGNATURE_LENGTH } = require('../helpers/signing-keys')
const { GenericStub } = require('../helpers/stubs/generic.stub')

contract('Lido deposit scenarios', ([staker, depositor]) => {
  const STAKING_MODULE_ID = 1
  const DEPOSIT_CALLDATA = '0x0'
  let lido, stakingRouter
  let stakingModuleStub, depositContractStub
  let snapshot

  before('prepare base Lido & StakingRouter setup', async () => {
    stakingModuleStub = await StakingModuleStub.new()
    depositContractStub = await GenericStub.new('contracts/0.6.11/deposit_contract.sol:IDepositContract')
    // just accept all ether and do nothing
    await GenericStub.stub(depositContractStub, 'deposit')
    const protocol = await deployProtocol({
      stakingModulesFactory: async () => {
        return [
          {
            module: stakingModuleStub,
            name: 'stubbed staking module',
            targetShares: 100_00,
            moduleFee: 5_00,
            treasuryFee: 5_00,
          },
        ]
      },
      depositSecurityModuleFactory: async () => ({ address: depositor }),
      depositContractFactory: () => depositContractStub,
      postSetup: async ({ pool, lidoLocator, eip712StETH, voting }) => {
        await pool.initialize(lidoLocator.address, eip712StETH.address, { value: wei.str`1 ether` })
        await pool.resumeProtocolAndStaking({ from: voting.address })
      },
    })
    lido = protocol.pool
    stakingRouter = protocol.stakingRouter
    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(() => snapshot.rollback())

  it('StakingRouter has non zero ETH balance & lido has unaccounted ether', async () => {
    // add extra ETH value to the StakingRouter
    const initialStakingRouterBalance = wei`1 ether`
    await setBalance(stakingRouter, initialStakingRouterBalance)
    assert.equal(await getBalance(stakingRouter), initialStakingRouterBalance)

    // add unaccounted ETH to Lido
    const unaccountedLidoETHBalance = wei`1 gwei`
    const initialLidoETHBalance = await getBalance(lido)
    await setBalance(lido, initialLidoETHBalance + unaccountedLidoETHBalance)
    assert.equal(await getBalance(lido), initialLidoETHBalance + unaccountedLidoETHBalance)

    const depositableValidatorsCount = 2
    await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
      totalExitedValidators: 5,
      totalDepositedValidators: 16,
      depositableValidatorsCount,
    })

    const depositDataLength = depositableValidatorsCount
    await StakingModuleStub.stubObtainDepositData(stakingModuleStub, {
      return: { depositDataLength },
    })

    const submitAmount = wei`320 ether`
    await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

    assert.equal(await getBalance(lido), initialLidoETHBalance + unaccountedLidoETHBalance + submitAmount)

    const maxDepositsCount = 10
    await lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor })

    assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)
    const depositedEther = wei`32 ether` * wei.min(maxDepositsCount, depositableValidatorsCount)
    assert.equals(
      await getBalance(lido),
      initialLidoETHBalance + unaccountedLidoETHBalance + submitAmount - depositedEther
    )
  })

  describe('StakingModule returns invalid data', () => {
    it('obtainDepositData() returns more publicKeys and signatures than expected', async () => {
      const initialStakingRouterBalance = wei`1 ether`
      await setBalance(stakingRouter, initialStakingRouterBalance)
      assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      const depositDataLength = depositableValidatorsCount + 2
      await StakingModuleStub.stubObtainDepositData(stakingModuleStub, {
        return: { depositDataLength },
      })

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidPublicKeysBatchLength',
        [PUBKEY_LENGTH * depositDataLength, PUBKEY_LENGTH * depositableValidatorsCount]
      )
    })

    it('obtainDepositData() returns more publicKeys than expected', async () => {
      const initialStakingRouterBalance = wei`1 ether`
      await setBalance(stakingRouter, initialStakingRouterBalance)
      assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      const depositDataLength = depositableValidatorsCount + 2
      const depositData = new FakeValidatorKeys(depositDataLength)
      await StakingModuleStub.stubObtainDepositData(stakingModuleStub, {
        return: {
          publicKeysBatch: depositData.slice()[0], // two extra signatures returned
          signaturesBatch: depositData.slice(0, depositableValidatorsCount)[1],
        },
      })

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidPublicKeysBatchLength',
        [PUBKEY_LENGTH * depositDataLength, PUBKEY_LENGTH * depositableValidatorsCount]
      )
    })

    it('obtainDepositData() returns more signatures than expected', async () => {
      const initialStakingRouterBalance = wei`1 ether`
      await setBalance(stakingRouter, initialStakingRouterBalance)
      assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      const depositDataLength = depositableValidatorsCount + 2
      const depositData = new FakeValidatorKeys(depositDataLength)
      await StakingModuleStub.stubObtainDepositData(stakingModuleStub, {
        return: {
          publicKeysBatch: depositData.slice(0, depositableValidatorsCount)[0],
          signaturesBatch: depositData.slice()[1], // two extra signatures returned
        },
      })

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidSignaturesBatchLength',
        [SIGNATURE_LENGTH * depositDataLength, SIGNATURE_LENGTH * depositableValidatorsCount]
      )
    })

    it('invalid ETH value was used for deposits in StakingRouter', async () => {
      // on each deposit call forward back 1 ether to the staking router
      await GenericStub.stub(depositContractStub, 'deposit', {
        forwardETH: { value: wei.str`1 ether`, recipient: stakingRouter.address },
      })

      const submitAmount = wei`320 ether`
      const initialLidoETHBalance = await getBalance(lido)
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equal(await getBalance(lido), initialLidoETHBalance + submitAmount)

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      const depositDataLength = depositableValidatorsCount
      await StakingModuleStub.stubObtainDepositData(stakingModuleStub, {
        return: { depositDataLength },
      })
      const maxDepositsCount = 10
      await assert.reverts(lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }))
    })

    it('StakingModule reverted on obtainData', async () => {
      const submitAmount = wei`320 ether`
      const initialLidoETHBalance = await getBalance(lido)
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equal(await getBalance(lido), initialLidoETHBalance + submitAmount)

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      await StakingModuleStub.stub(stakingModuleStub, 'obtainDepositData', {
        revert: { reason: 'INVALID_ALLOCATED_KEYS_COUNT' },
      })

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'INVALID_ALLOCATED_KEYS_COUNT'
      )
    })

    it('Zero deposit updates lastDepositAt and lastDepositBlock fields', async () => {
      const submitAmount = wei`100 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      const depositableValidatorsCount = 2
      await StakingModuleStub.stubGetStakingModuleSummary(stakingModuleStub, {
        totalExitedValidators: 5,
        totalDepositedValidators: 16,
        depositableValidatorsCount,
      })

      const stakingModuleStateBefore = await stakingRouter.getStakingModule(STAKING_MODULE_ID)

      const maxDepositsCount = 0
      await lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor })

      const stakingModuleStateAfter = await stakingRouter.getStakingModule(STAKING_MODULE_ID)

      assert.notEquals(stakingModuleStateBefore.lastDepositAt, stakingModuleStateAfter.lastDepositAt)
      assert.notEquals(stakingModuleStateBefore.lastDepositBlock, stakingModuleStateAfter.lastDepositBlock)
    })
  })
})
