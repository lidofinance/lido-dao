const { contract, ethers } = require('hardhat')
const { deployProtocol } = require('../helpers/protocol')
const { EvmSnapshot, setBalance, getBalance } = require('../helpers/blockchain')
const { ZERO_ADDRESS } = require('../helpers/constants')
const { assert } = require('../helpers/assert')
const { wei } = require('../helpers/wei')
const { PUBKEY_LENGTH, FakeValidatorKeys, SIGNATURE_LENGTH } = require('../helpers/signing-keys')
const { ContractStub } = require('../helpers/contract-stub')

contract('Lido deposit scenarios', ([deployer, staker, depositor]) => {
  const STAKING_MODULE_ID = 1
  const DEPOSIT_CALLDATA = '0x0'
  const TOTAL_EXITED_VALIDATORS = 5
  const TOTAL_DEPOSITED_VALIDATORS = 16
  const DEPOSITABLE_VALIDATORS_COUNT = 2

  let lido, stakingRouter
  let stakingModuleStub, depositContractStub
  let snapshot

  const stubObtainDepositDataReturns = (publicKeysBatch, signaturesBatch) =>
    ContractStub(stakingModuleStub)
      .on('obtainDepositData', {
        return: {
          type: ['bytes', 'bytes'],
          value: [publicKeysBatch, signaturesBatch],
        },
      })
      .update({ from: deployer })

  before('prepare base Lido & StakingRouter setup', async () => {
    stakingModuleStub = await ContractStub('IStakingModule')
      .on('getStakingModuleSummary', {
        return: {
          type: ['uint256', 'uint256', 'uint256'],
          value: [TOTAL_EXITED_VALIDATORS, TOTAL_DEPOSITED_VALIDATORS, DEPOSITABLE_VALIDATORS_COUNT],
        },
      })
      .create({ from: deployer })

    depositContractStub = await ContractStub('contracts/0.6.11/deposit_contract.sol:IDepositContract')
      .on('deposit') // just accept all ether and do nothing
      .create({ from: deployer })

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

    const depositDataLength = DEPOSITABLE_VALIDATORS_COUNT
    await stubObtainDepositDataReturns(...new FakeValidatorKeys(depositDataLength).slice())

    const submitAmount = wei`320 ether`
    await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

    assert.equal(await getBalance(lido), initialLidoETHBalance + unaccountedLidoETHBalance + submitAmount)

    const maxDepositsCount = 10
    await lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor })

    assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)
    const depositedEther = wei`32 ether` * wei.min(maxDepositsCount, DEPOSITABLE_VALIDATORS_COUNT)
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

      const depositDataLength = DEPOSITABLE_VALIDATORS_COUNT + 2
      await stubObtainDepositDataReturns(...new FakeValidatorKeys(depositDataLength).slice())

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidPublicKeysBatchLength',
        [PUBKEY_LENGTH * depositDataLength, PUBKEY_LENGTH * DEPOSITABLE_VALIDATORS_COUNT]
      )
    })

    it('obtainDepositData() returns more publicKeys than expected', async () => {
      const initialStakingRouterBalance = wei`1 ether`
      await setBalance(stakingRouter, initialStakingRouterBalance)
      assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)

      const depositDataLength = DEPOSITABLE_VALIDATORS_COUNT + 2
      const depositData = new FakeValidatorKeys(depositDataLength)
      await stubObtainDepositDataReturns(
        depositData.slice()[0], // two extra public keys returned
        depositData.slice(0, DEPOSITABLE_VALIDATORS_COUNT)[1]
      )

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidPublicKeysBatchLength',
        [PUBKEY_LENGTH * depositDataLength, PUBKEY_LENGTH * DEPOSITABLE_VALIDATORS_COUNT]
      )
    })

    it('obtainDepositData() returns more signatures than expected', async () => {
      const initialStakingRouterBalance = wei`1 ether`
      await setBalance(stakingRouter, initialStakingRouterBalance)
      assert.equals(await getBalance(stakingRouter), initialStakingRouterBalance)

      const depositDataLength = DEPOSITABLE_VALIDATORS_COUNT + 2
      const depositData = new FakeValidatorKeys(depositDataLength)
      await stubObtainDepositDataReturns(
        depositData.slice(0, DEPOSITABLE_VALIDATORS_COUNT)[0],
        depositData.slice()[1] // two extra signatures returned
      )

      const initialLidETHBalance = await getBalance(lido)

      const submitAmount = wei`320 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equals(await getBalance(lido), initialLidETHBalance + submitAmount)

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'InvalidSignaturesBatchLength',
        [SIGNATURE_LENGTH * depositDataLength, SIGNATURE_LENGTH * DEPOSITABLE_VALIDATORS_COUNT]
      )
    })

    it('invalid ETH value was used for deposits in StakingRouter', async () => {
      // on each deposit call forward back 1 ether to the staking router
      await ContractStub(depositContractStub)
        .on('deposit', {
          ethForwards: [{ recipient: stakingRouter.address, value: wei.str`1 ether` }],
        })
        .update({ from: deployer })

      const submitAmount = wei`320 ether`
      const initialLidoETHBalance = await getBalance(lido)
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equal(await getBalance(lido), initialLidoETHBalance + submitAmount)

      const depositDataLength = DEPOSITABLE_VALIDATORS_COUNT
      await stubObtainDepositDataReturns(...new FakeValidatorKeys(depositDataLength).slice())

      const maxDepositsCount = 10
      await assert.reverts(lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }))
    })

    it('StakingModule reverted on obtainData', async () => {
      const submitAmount = wei`320 ether`
      const initialLidoETHBalance = await getBalance(lido)
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      assert.equal(await getBalance(lido), initialLidoETHBalance + submitAmount)

      await ContractStub(stakingModuleStub)
        .on('obtainDepositData', {
          revert: { reason: 'INVALID_ALLOCATED_KEYS_COUNT' },
        })
        .update({ from: deployer })

      const maxDepositsCount = 10
      await assert.reverts(
        lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor }),
        'INVALID_ALLOCATED_KEYS_COUNT'
      )
    })

    it('Zero deposit updates lastDepositAt and lastDepositBlock fields', async () => {
      const submitAmount = wei`100 ether`
      await lido.submit(ZERO_ADDRESS, { from: staker, value: wei.str(submitAmount) })

      const stakingModuleStateBefore = await stakingRouter.getStakingModule(STAKING_MODULE_ID)

      const maxDepositsCount = 0
      await lido.deposit(maxDepositsCount, STAKING_MODULE_ID, DEPOSIT_CALLDATA, { from: depositor })

      const stakingModuleStateAfter = await stakingRouter.getStakingModule(STAKING_MODULE_ID)

      assert.notEquals(stakingModuleStateBefore.lastDepositAt, stakingModuleStateAfter.lastDepositAt)
      assert.notEquals(stakingModuleStateBefore.lastDepositBlock, stakingModuleStateAfter.lastDepositBlock)
    })
  })
})
