const { artifacts, contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')

const StakingRouter = artifacts.require('StakingRouterMock.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

contract('StakingRouter', (accounts) => {
  let evmSnapshotId
  let depositContract, stakingRouter
  let curatedStakingModuleMock, soloStakingModuleMock
  const [deployer, lido, admin] = accounts

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })
    ;[curatedStakingModuleMock, soloStakingModuleMock] = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
    ])

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, lido, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, STAKING_MODULE_PAUSE_ROLE, STAKING_MODULE_MANAGE_ROLE] =
      await Promise.all([
        stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
        stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
        stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
      ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, admin, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, admin, { from: admin })

    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await ethers.provider.send('evm_snapshot', [])
  })

  describe('One staking module', () => {
    beforeEach(async () => {
      await stakingRouter.addStakingModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // target share 100 %
        1_000, // module fee 10 %
        5_000, // treasury fee 5 %
        { from: admin }
      )
    })

    it('getDepositsAllocation :: staking module without keys', async () => {
      const { allocated, allocations } = await stakingRouter.getDepositsAllocation(0)

      assert.equals(allocated, 0)
      assert.equals(allocations.length, 1)
      assert.equals(allocations[0], 0)
    })

    it('getDepositsAllocation :: staking module with zero used keys', async () => {
      await curatedStakingModuleMock.setAvailableKeysCount(500)
      assert.equals(await curatedStakingModuleMock.getAvailableValidatorsCount(), 500)

      const { allocated, allocations } = await stakingRouter.getDepositsAllocation(1000)

      assert.equals(allocated, 500)
      assert.equal(allocations.length, 1)
      assert.equals(allocations[0], 500)
    })

    it('getDepositsAllocation :: staking module with non zero used keys', async () => {
      await curatedStakingModuleMock.setActiveValidatorsCount(250)
      assert.equals(await curatedStakingModuleMock.getActiveValidatorsCount(), 250)

      await curatedStakingModuleMock.setAvailableKeysCount(250)
      assert.equals(await curatedStakingModuleMock.getAvailableValidatorsCount(), 250)

      const { allocated, allocations } = await stakingRouter.getDepositsAllocation(250)

      assert.equals(allocated, 250)
      assert.equal(allocations.length, 1)
      assert.equals(allocations[0], 500)
    })
  })

  describe('Two staking modules', () => {
    beforeEach(async () => {
      await stakingRouter.addStakingModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      await stakingRouter.addStakingModule(
        'Solo',
        soloStakingModuleMock.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: admin }
      )
    })

    it('getDepositsAllocation :: equal available keys', async () => {
      await curatedStakingModuleMock.setActiveValidatorsCount(4500)
      assert.equals(await curatedStakingModuleMock.getActiveValidatorsCount(), 4500)

      await curatedStakingModuleMock.setAvailableKeysCount(500)
      assert.equals(await curatedStakingModuleMock.getAvailableValidatorsCount(), 500)

      await soloStakingModuleMock.setActiveValidatorsCount(50)
      assert.equals(await soloStakingModuleMock.getActiveValidatorsCount(), 50)

      await soloStakingModuleMock.setAvailableKeysCount(250)
      assert.equals(await soloStakingModuleMock.getAvailableValidatorsCount(), 250)

      const { allocated, allocations } = await stakingRouter.getDepositsAllocation(333)

      assert.equals(allocated, 333)
      assert.equal(allocations.length, 2)

      assert.equals(allocations[0], 4786)
      // newTotalKeysCount: 4883 -> 0.02 * 4883 = 97
      assert.equals(allocations[1], 97)
    })
  })

  describe('Make deposit', () => {
    beforeEach(async () => {
      await stakingRouter.addStakingModule(
        'Curated',
        curatedStakingModuleMock.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      await stakingRouter.addStakingModule(
        'Solo',
        soloStakingModuleMock.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: admin }
      )
    })

    it('Lido.deposit() :: transfer balance', async () => {})
  })
})
