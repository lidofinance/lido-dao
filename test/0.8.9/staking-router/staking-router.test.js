const { artifacts, contract, ethers } = require('hardhat')
const { MaxUint256 } = require('@ethersproject/constants')
const { utils } = require('web3')
const { BN } = require('bn.js')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')
const { ETH, toBN } = require('../../helpers/utils')
const { ContractStub } = require('../../helpers/contract-stub')

const OssifiableProxy = artifacts.require('OssifiableProxy.sol')
const DepositContractMock = artifacts.require('DepositContractMock')
const StakingRouter = artifacts.require('StakingRouter.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const MANAGE_WITHDRAWAL_CREDENTIALS_ROLE = utils.soliditySha3('MANAGE_WITHDRAWAL_CREDENTIALS_ROLE')
const STAKING_MODULE_PAUSE_ROLE = utils.soliditySha3('STAKING_MODULE_PAUSE_ROLE')
const STAKING_MODULE_RESUME_ROLE = utils.soliditySha3('STAKING_MODULE_RESUME_ROLE')
const STAKING_MODULE_MANAGE_ROLE = utils.soliditySha3('STAKING_MODULE_MANAGE_ROLE')

const StakingModuleStatus = {
  Active: 0, // deposits and rewards allowed
  DepositsPaused: 1, // deposits NOT allowed, rewards allowed
  Stopped: 2, // deposits and rewards NOT allowed
}

contract('StakingRouter', ([deployer, lido, admin, appManager, stranger]) => {
  const evmSnapshot = new EvmSnapshot(ethers.provider)

  const snapshot = () => evmSnapshot.make()
  const revert = () => evmSnapshot.revert()

  let depositContract, router
  let initialTx
  let module1, module2
  const wc = '0x'.padEnd(66, '1234')

  before(async () => {
    depositContract = await DepositContractMock.new({ from: deployer })

    const impl = await StakingRouter.new(depositContract.address, { from: deployer })
    const proxy = await OssifiableProxy.new(impl.address, deployer, '0x')
    router = await StakingRouter.at(proxy.address)
    ;[module1, module2] = await Promise.all([
      StakingModuleMock.new({ from: deployer }),
      StakingModuleMock.new({ from: deployer }),
    ])

    const wc = '0x'.padEnd(66, '1234')
    initialTx = await router.initialize(admin, lido, wc, { from: deployer })

    // await router.grantRole(await router.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), admin, { from: admin })
    // await router.grantRole(await router.STAKING_MODULE_PAUSE_ROLE(), admin, { from: admin })
    // await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
    // await router.grantRole(await router.REPORT_EXITED_VALIDATORS_ROLE(), admin, { from: admin })
  })

  describe('setup env', async () => {
    it('initialized correctly', async () => {
      assert.equals(await router.getContractVersion(), 1)
      assert.equals(await router.getWithdrawalCredentials(), wc)
      assert.equals(await router.getLido(), lido)
      assert.equals(await router.getStakingModulesCount(), 0)
      assert.equals(await router.hasStakingModule(0), false)
      assert.equals(await router.hasStakingModule(1), false)

      assert.equals(await router.getRoleMemberCount(DEFAULT_ADMIN_ROLE), 1)
      assert.equals(await router.hasRole(DEFAULT_ADMIN_ROLE, admin), true)

      assert.equals(initialTx.logs.length, 3)

      await assert.emits(initialTx, 'ContractVersionSet', { version: 1 })
      await assert.emits(initialTx, 'RoleGranted', { role: DEFAULT_ADMIN_ROLE, account: admin, sender: deployer })
      await assert.emits(initialTx, 'WithdrawalCredentialsSet', { withdrawalCredentials: wc })
    })

    it('init fails on wrong input', async () => {
      await assert.revertsWithCustomError(
        router.initialize(ZERO_ADDRESS, lido, wc, { from: deployer }),
        'ZeroAddress("_admin")'
      )
      await assert.revertsWithCustomError(
        router.initialize(admin, ZERO_ADDRESS, wc, { from: deployer }),
        'ZeroAddress("_lido")'
      )
    })

    it('second initialize reverts', async () => {
      await assert.revertsWithCustomError(
        router.initialize(admin, lido, wc, { from: deployer }),
        'NonZeroContractVersionOnInit()'
      )
    })

    it('stranger is not allowed to grant roles', async () => {
      await assert.reverts(
        router.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it('grant role MANAGE_WITHDRAWAL_CREDENTIALS_ROLE', async () => {
      const tx = await router.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager, { from: admin })
      assert.equals(await router.getRoleMemberCount(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE), 1)
      assert.equals(await router.hasRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', {
        role: MANAGE_WITHDRAWAL_CREDENTIALS_ROLE,
        account: appManager,
        sender: admin,
      })
    })

    it('grant role STAKING_MODULE_PAUSE_ROLE', async () => {
      const tx = await router.grantRole(STAKING_MODULE_PAUSE_ROLE, appManager, { from: admin })
      assert.equals(await router.getRoleMemberCount(STAKING_MODULE_PAUSE_ROLE), 1)
      assert.equals(await router.hasRole(STAKING_MODULE_PAUSE_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_PAUSE_ROLE, account: appManager, sender: admin })
    })

    it('grant role STAKING_MODULE_RESUME_ROLE', async () => {
      const tx = await router.grantRole(STAKING_MODULE_RESUME_ROLE, appManager, { from: admin })
      assert.equals(await router.getRoleMemberCount(STAKING_MODULE_RESUME_ROLE), 1)
      assert.equals(await router.hasRole(STAKING_MODULE_RESUME_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_RESUME_ROLE, account: appManager, sender: admin })
    })

    it('grant role STAKING_MODULE_MANAGE_ROLE', async () => {
      const tx = await router.grantRole(STAKING_MODULE_MANAGE_ROLE, appManager, { from: admin })
      assert.equals(await router.getRoleMemberCount(STAKING_MODULE_MANAGE_ROLE), 1)
      assert.equals(await router.hasRole(STAKING_MODULE_MANAGE_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_MANAGE_ROLE, account: appManager, sender: admin })
    })

    it('public constants', async () => {
      assert.equals(await router.FEE_PRECISION_POINTS(), new BN('100000000000000000000'))
      assert.equals(await router.TOTAL_BASIS_POINTS(), 10000)
      assert.equals(await router.DEPOSIT_CONTRACT(), depositContract.address)
      assert.equals(await router.DEFAULT_ADMIN_ROLE(), DEFAULT_ADMIN_ROLE)
      assert.equals(await router.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), MANAGE_WITHDRAWAL_CREDENTIALS_ROLE)
      assert.equals(await router.STAKING_MODULE_PAUSE_ROLE(), STAKING_MODULE_PAUSE_ROLE)
      assert.equals(await router.STAKING_MODULE_RESUME_ROLE(), STAKING_MODULE_RESUME_ROLE)
      assert.equals(await router.STAKING_MODULE_MANAGE_ROLE(), STAKING_MODULE_MANAGE_ROLE)
    })

    it('getDepositsAllocation', async () => {
      const keysAllocation = await router.getDepositsAllocation(1000)

      assert.equals(keysAllocation.allocated, 0)
      assert.equals(keysAllocation.allocations, [])
    })
  })

  describe('implementation', async () => {
    let stakingRouterImplementation

    before(async () => {
      await snapshot()
      stakingRouterImplementation = await StakingRouter.new(depositContract.address, { from: deployer })
    })

    after(async () => {
      await revert()
    })

    it('contract version is max uint256', async () => {
      assert.equals(await stakingRouterImplementation.getContractVersion(), MaxUint256)
    })

    it('initialize reverts on implementation', async () => {
      await assert.revertsWithCustomError(
        stakingRouterImplementation.initialize(admin, lido, wc, { from: deployer }),
        `NonZeroContractVersionOnInit()`
      )
    })

    it('has no granted roles', async () => {
      assert.equals(await stakingRouterImplementation.getRoleMemberCount(DEFAULT_ADMIN_ROLE), 0)
      assert.equals(await stakingRouterImplementation.getRoleMemberCount(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE), 0)
      assert.equals(await stakingRouterImplementation.getRoleMemberCount(STAKING_MODULE_PAUSE_ROLE), 0)
      assert.equals(await stakingRouterImplementation.getRoleMemberCount(STAKING_MODULE_RESUME_ROLE), 0)
      assert.equals(await stakingRouterImplementation.getRoleMemberCount(STAKING_MODULE_MANAGE_ROLE), 0)
    })

    it('state is empty', async () => {
      assert.equals(await stakingRouterImplementation.getWithdrawalCredentials(), ZERO_BYTES32)
      assert.equals(await stakingRouterImplementation.getLido(), ZERO_ADDRESS)
      assert.equals(await stakingRouterImplementation.getStakingModulesCount(), 0)
    })

    it('deposit fails without role', async () => {
      await assert.revertsWithCustomError(
        stakingRouterImplementation.deposit(100, 0, '0x00', { from: stranger }),
        `AppAuthLidoFailed()`
      )
    })
  })

  describe('staking router', async () => {
    let stakingModule
    before(async () => {
      await snapshot()

      stakingModule = await StakingModuleMock.new({ from: deployer })

      assert.equals(await router.hasStakingModule(1), false)
      await router.addStakingModule('Test module', stakingModule.address, 100, 1000, 2000, {
        from: appManager,
      })
      assert.equals(await router.hasStakingModule(1), true)

      await stakingModule.setAvailableKeysCount(100, { from: deployer })

      assert.equals(await stakingModule.getAvailableValidatorsCount(), 100)
    })

    after(async () => {
      await revert()
    })

    it('reverts if module is unregistered', async () => {
      await assert.reverts(router.getStakingModuleIsActive(123), `StakingModuleUnregistered()`)
      await assert.reverts(router.getStakingModuleLastDepositBlock(123), `StakingModuleUnregistered()`)
      await assert.reverts(router.getStakingModuleIsDepositsPaused(123), `StakingModuleUnregistered()`)
      await assert.reverts(router.getStakingModuleNonce(123), `StakingModuleUnregistered()`)
      await assert.reverts(router.getStakingModuleIsStopped(123), `StakingModuleUnregistered()`)
      await assert.reverts(router.getStakingModuleStatus(123), `StakingModuleUnregistered()`)
    })

    it('reverts if module address exists', async () => {
      await assert.revertsWithCustomError(
        router.addStakingModule('Test', stakingModule.address, 100, 1000, 2000, { from: appManager }),
        'StakingModuleAddressExists()'
      )
    })

    it('set withdrawal credentials does not allowed without role', async () => {
      const newWC = '0x'.padEnd(66, '5678')
      await assert.reverts(
        router.setWithdrawalCredentials(newWC, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${MANAGE_WITHDRAWAL_CREDENTIALS_ROLE}`
      )
    })

    it('set withdrawal credentials', async () => {
      const newWC = '0x'.padEnd(66, '5678')
      const tx = await router.setWithdrawalCredentials(newWC, { from: appManager })

      await assert.emits(tx, 'WithdrawalCredentialsSet', { withdrawalCredentials: newWC })

      assert.equals(await stakingModule.getAvailableValidatorsCount(), 0)
    })

    it('direct transfer fails', async () => {
      const value = 100
      await assert.revertsWithCustomError(router.sendTransaction({ value, from: deployer }), `DirectETHTransfer()`)
    })

    it('getStakingModuleNonce', async () => {
      await stakingModule.setNonce(100, { from: deployer })

      assert.equals(await router.getStakingModuleNonce(1), 100)
    })

    it('getStakingModuleActiveValidatorsCount', async () => {
      await stakingModule.setActiveValidatorsCount(200, { from: deployer })
      assert.equals(await router.getStakingModuleActiveValidatorsCount(1), 200)
    })

    it('getStakingRewardsDistribution - only one module has active keys', async () => {
      await stakingModule.setActiveValidatorsCount(40, { from: deployer })

      // no active keys for second module
      const anotherStakingModule = await StakingModuleMock.new({ from: deployer })
      await router.addStakingModule('Test module 2', anotherStakingModule.address, 100, 1000, 2000, {
        from: appManager,
      })
      await anotherStakingModule.setAvailableKeysCount(50, { from: deployer })

      const stakingModuleIds = await router.getStakingModuleIds()
      let rewardDistribution = await router.getStakingRewardsDistribution()

      assert.equal(stakingModuleIds.length, 2)
      // only one module in distribution
      assert.equal(rewardDistribution.stakingModuleIds.length, 1)
      assert.deepEqual(rewardDistribution.stakingModuleIds, [stakingModuleIds[0]])
      // expect(rewardDistribution.stakingModuleIds).to.deep.equal([stakingModuleIds[0]])
      const percentPoints = toBN(100)
      // 10% = 10% from (100% of active validator)
      assert.equal(
        rewardDistribution.stakingModuleFees[0].mul(percentPoints).div(rewardDistribution.precisionPoints).toNumber(),
        10
      )

      // 2nd module has active keys
      await anotherStakingModule.setActiveValidatorsCount(10, { from: deployer })
      rewardDistribution = await router.getStakingRewardsDistribution()
      assert.deepEqual(rewardDistribution.stakingModuleIds, stakingModuleIds)
      // 8% = 10% from (80% of active validator)
      assert.equal(
        rewardDistribution.stakingModuleFees[0].mul(percentPoints).div(rewardDistribution.precisionPoints).toNumber(),
        8
      )
      // 2% = 10% from (20% of active validator)
      assert.equal(
        rewardDistribution.stakingModuleFees[1].mul(percentPoints).div(rewardDistribution.precisionPoints).toNumber(),
        2
      )
    })

    it('set withdrawal credentials works when staking module reverts', async () => {
      // staking module will revert with panic exit code
      const buggedStakingModule = await ContractStub('IStakingModule')
        .on('onWithdrawalCredentialsChanged', {
          revert: { error: { name: 'Panic', args: { type: ['uint256'], value: [0x01] } } },
        })
        .create({ from: deployer })

      await router.addStakingModule('Staking Module With Bug', buggedStakingModule.address, 100, 1000, 2000, {
        from: appManager,
      })
      const stakingModuleId = await router.getStakingModulesCount()
      assert.isFalse(await router.getStakingModuleIsDepositsPaused(stakingModuleId))

      const newWC = '0x'.padEnd(66, '5678')
      const tx = await router.setWithdrawalCredentials(newWC, { from: appManager })

      assert.emits(tx, 'WithdrawalsCredentialsChangeFailed', {
        stakingModuleId,
        lowLevelRevertData: '0x4e487b710000000000000000000000000000000000000000000000000000000000000001',
      })

      assert.emits(
        tx,
        'StakingModuleStatusSet',
        {
          status: 1,
          stakingModuleId,
          setBy: appManager,
        },
        { abi: StakingRouter._json.abi }
      )

      assert.isTrue(await router.getStakingModuleIsDepositsPaused(stakingModuleId))

      // staking module will revert with out of gas error (revert data is empty bytes)
      await ContractStub(buggedStakingModule)
        .on('onWithdrawalCredentialsChanged', { revert: { reason: 'outOfGas' } })
        .update({ from: deployer })

      await assert.reverts(router.setWithdrawalCredentials(newWC, { from: appManager }), 'UnrecoverableModuleError()')
    })
  })

  describe('staking modules limit', async () => {
    before(snapshot)
    after(revert)

    it('staking modules limit is 32', async () => {
      for (let i = 0; i < 32; i++) {
        const stakingModule = await StakingModuleMock.new({ from: deployer })
        assert.equals(await router.hasStakingModule(i + 1), false)
        await router.addStakingModule('Test module', stakingModule.address, 100, 100, 100, { from: appManager })
        assert.equals(await router.hasStakingModule(i + 1), true)
      }

      const oneMoreStakingModule = await StakingModuleMock.new({ from: deployer })
      await assert.revertsWithCustomError(
        router.addStakingModule('Test module', oneMoreStakingModule.address, 100, 100, 100, { from: appManager }),
        `StakingModulesLimitExceeded()`
      )
    })
  })

  describe('manage staking modules', async () => {
    let stakingModule1, stakingModule2

    const stakingModulesParams = [
      {
        name: 'Test module 1',
        targetShare: 1000,
        stakingModuleFee: 2000,
        treasuryFee: 200,
        expectedModuleId: 1,
        address: null,
        lastDepositAt: null,
        lastDepositBlock: null,
      },
      {
        name: 'Test module 1',
        targetShare: 1000,
        stakingModuleFee: 2000,
        treasuryFee: 200,
        expectedModuleId: 2,
        address: null,
        lastDepositAt: null,
        lastDepositBlock: null,
      },
    ]

    before(async () => {
      await snapshot()

      stakingModule1 = await StakingModuleMock.new({ from: deployer })
      stakingModule2 = await StakingModuleMock.new({ from: deployer })

      stakingModulesParams[0].address = stakingModule1.address
      stakingModulesParams[1].address = stakingModule2.address
    })

    after(revert)

    it('addStakingModule call is not allowed from stranger', async () => {
      await assert.reverts(
        router.addStakingModule(
          stakingModulesParams[0].name,
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          { from: stranger }
        ),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_MANAGE_ROLE}`
      )
    })

    it('addStakingModule fails on share > 100%', async () => {
      await assert.revertsWithCustomError(
        router.addStakingModule(
          stakingModulesParams[0].name,
          stakingModule1.address,
          10001,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          { from: appManager }
        ),
        `ValueOver100Percent("_targetShare")`
      )
    })

    it('addStakingModule fails on fees > 100%', async () => {
      await assert.revertsWithCustomError(
        router.addStakingModule(
          stakingModulesParams[0].name,
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          5000,
          5001,
          {
            from: appManager,
          }
        ),
        `ValueOver100Percent("_stakingModuleFee + _treasuryFee")`
      )
    })

    it('addStakingModule fails on zero address', async () => {
      await assert.revertsWithCustomError(
        router.addStakingModule(
          stakingModulesParams[0].name,
          ZERO_ADDRESS,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager,
          }
        ),
        `ZeroAddress("_stakingModuleAddress")`
      )
    })

    it('addStakingModule fails on incorrect module name', async () => {
      // check zero length
      await assert.revertsWithCustomError(
        router.addStakingModule(
          '',
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager,
          }
        ),
        `StakingModuleWrongName()`
      )

      // check length > 31 symbols
      await assert.revertsWithCustomError(
        router.addStakingModule(
          '#'.repeat(32),
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager,
          }
        ),
        `StakingModuleWrongName()`
      )
    })

    it('add staking module', async () => {
      const tx = await router.addStakingModule(
        stakingModulesParams[0].name,
        stakingModule1.address,
        stakingModulesParams[0].targetShare,
        stakingModulesParams[0].stakingModuleFee,
        stakingModulesParams[0].treasuryFee,
        {
          from: appManager,
        }
      )
      const latestBlock = await ethers.provider.getBlock()
      stakingModulesParams[0].lastDepositAt = latestBlock.timestamp
      stakingModulesParams[0].lastDepositBlock = latestBlock.number

      assert.equals(tx.logs.length, 4)
      await assert.emits(tx, 'StakingModuleAdded', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        stakingModule: stakingModule1.address,
        name: stakingModulesParams[0].name,
        createdBy: appManager,
      })
      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        targetShare: stakingModulesParams[0].targetShare,
        setBy: appManager,
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        stakingModuleFee: stakingModulesParams[0].stakingModuleFee,
        treasuryFee: stakingModulesParams[0].treasuryFee,
        setBy: appManager,
      })
      await assert.emits(tx, 'StakingRouterETHDeposited', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        amount: 0,
      })

      assert.equals(await router.getStakingModulesCount(), 1)
      assert.equals(
        await router.getStakingModuleStatus(stakingModulesParams[0].expectedModuleId),
        StakingModuleStatus.Active
      )
      assert.equals(await router.getStakingModuleIsStopped(stakingModulesParams[0].expectedModuleId), false)
      assert.equals(await router.getStakingModuleIsDepositsPaused(stakingModulesParams[0].expectedModuleId), false)
      assert.equals(await router.getStakingModuleIsActive(stakingModulesParams[0].expectedModuleId), true)

      const module = await router.getStakingModule(stakingModulesParams[0].expectedModuleId)

      assert.equals(module.name, stakingModulesParams[0].name)
      assert.equals(module.stakingModuleAddress, stakingModule1.address)
      assert.equals(module.stakingModuleFee, stakingModulesParams[0].stakingModuleFee)
      assert.equals(module.treasuryFee, stakingModulesParams[0].treasuryFee)
      assert.equals(module.targetShare, stakingModulesParams[0].targetShare)
      assert.equals(module.status, StakingModuleStatus.Active)
      assert.equals(module.lastDepositAt, stakingModulesParams[0].lastDepositAt)
      assert.equals(module.lastDepositBlock, stakingModulesParams[0].lastDepositBlock)
    })

    it('add another staking module', async () => {
      const tx = await router.addStakingModule(
        stakingModulesParams[1].name,
        stakingModule2.address,
        stakingModulesParams[1].targetShare,
        stakingModulesParams[1].stakingModuleFee,
        stakingModulesParams[1].treasuryFee,
        {
          from: appManager,
        }
      )
      const latestBlock = await ethers.provider.getBlock()
      stakingModulesParams[1].lastDepositAt = latestBlock.timestamp
      stakingModulesParams[1].lastDepositBlock = latestBlock.number

      assert.equals(tx.logs.length, 4)
      await assert.emits(tx, 'StakingModuleAdded', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        stakingModule: stakingModule2.address,
        name: stakingModulesParams[1].name,
        createdBy: appManager,
      })
      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        targetShare: stakingModulesParams[1].targetShare,
        setBy: appManager,
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        stakingModuleFee: stakingModulesParams[1].stakingModuleFee,
        treasuryFee: stakingModulesParams[1].treasuryFee,
        setBy: appManager,
      })
      await assert.emits(tx, 'StakingRouterETHDeposited', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        amount: 0,
      })

      assert.equals(await router.getStakingModulesCount(), 2)
      assert.equals(
        await router.getStakingModuleStatus(stakingModulesParams[1].expectedModuleId),
        StakingModuleStatus.Active
      )
      assert.equals(await router.getStakingModuleIsStopped(stakingModulesParams[1].expectedModuleId), false)
      assert.equals(await router.getStakingModuleIsDepositsPaused(stakingModulesParams[1].expectedModuleId), false)
      assert.equals(await router.getStakingModuleIsActive(stakingModulesParams[1].expectedModuleId), true)

      const module = await router.getStakingModule(stakingModulesParams[1].expectedModuleId)

      assert.equals(module.name, stakingModulesParams[1].name)
      assert.equals(module.stakingModuleAddress, stakingModule2.address)
      assert.equals(module.stakingModuleFee, stakingModulesParams[1].stakingModuleFee)
      assert.equals(module.treasuryFee, stakingModulesParams[1].treasuryFee)
      assert.equals(module.targetShare, stakingModulesParams[1].targetShare)
      assert.equals(module.status, StakingModuleStatus.Active)
      assert.equals(module.lastDepositAt, stakingModulesParams[1].lastDepositAt)
      assert.equals(module.lastDepositBlock, stakingModulesParams[1].lastDepositBlock)
    })

    it('get staking modules list', async () => {
      const stakingModules = await router.getStakingModules()

      for (let i = 0; i < 2; i++) {
        assert.equals(stakingModules[i].name, stakingModulesParams[i].name)
        assert.equals(stakingModules[i].stakingModuleAddress, stakingModulesParams[i].address)
        assert.equals(stakingModules[i].stakingModuleFee, stakingModulesParams[i].stakingModuleFee)
        assert.equals(stakingModules[i].treasuryFee, stakingModulesParams[i].treasuryFee)
        assert.equals(stakingModules[i].targetShare, stakingModulesParams[i].targetShare)
        assert.equals(stakingModules[i].status, StakingModuleStatus.Active)
        assert.equals(stakingModules[i].lastDepositAt, stakingModulesParams[i].lastDepositAt)
        assert.equals(stakingModules[i].lastDepositBlock, stakingModulesParams[i].lastDepositBlock)
      }
    })

    it('get staking module ids', async () => {
      const stakingModules = await router.getStakingModules()
      const stakingModuleIds = await router.getStakingModuleIds()

      for (let i = 0; i < stakingModules.length; i++) {
        assert.equals(stakingModules[i].id, stakingModuleIds[i])
      }
    })

    it('update staking module does not allowed without role', async () => {
      await assert.reverts(
        router.updateStakingModule(
          stakingModulesParams[0].expectedModuleId,
          stakingModulesParams[0].targetShare + 1,
          stakingModulesParams[0].stakingModuleFee + 1,
          stakingModulesParams[0].treasuryFee + 1,
          {
            from: stranger,
          }
        ),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_MANAGE_ROLE}`
      )
    })

    it('update staking module fails on target share > 100%', async () => {
      await assert.revertsWithCustomError(
        router.updateStakingModule(
          stakingModulesParams[0].expectedModuleId,
          10001,
          stakingModulesParams[0].stakingModuleFee + 1,
          stakingModulesParams[0].treasuryFee + 1,
          {
            from: appManager,
          }
        ),
        `ValueOver100Percent("_targetShare")`
      )
    })

    it('update staking module fails on fees > 100%', async () => {
      await assert.revertsWithCustomError(
        router.updateStakingModule(
          stakingModulesParams[0].expectedModuleId,
          stakingModulesParams[0].targetShare + 1,
          5000,
          5001,
          {
            from: appManager,
          }
        ),
        `ValueOver100Percent("_stakingModuleFee + _treasuryFee")`
      )
    })

    it('update staking module', async () => {
      const stakingModuleNewParams = {
        id: stakingModulesParams[0].expectedModuleId,
        targetShare: stakingModulesParams[0].targetShare + 1,
        stakingModuleFee: stakingModulesParams[0].stakingModuleFee + 1,
        treasuryFee: stakingModulesParams[0].treasuryFee + 1,
      }

      const tx = await router.updateStakingModule(
        stakingModuleNewParams.id,
        stakingModuleNewParams.targetShare,
        stakingModuleNewParams.stakingModuleFee,
        stakingModuleNewParams.treasuryFee,
        {
          from: appManager,
        }
      )

      assert.equals(tx.logs.length, 2)

      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModuleNewParams.id,
        targetShare: stakingModuleNewParams.targetShare,
        setBy: appManager,
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModuleNewParams.id,
        stakingModuleFee: stakingModuleNewParams.stakingModuleFee,
        treasuryFee: stakingModuleNewParams.treasuryFee,
        setBy: appManager,
      })
    })

    it('set staking module status does not allowed without role', async () => {
      await assert.reverts(
        router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
          from: stranger,
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_MANAGE_ROLE}`
      )
    })

    it('set staking module status reverts if status is the same', async () => {
      const module = await router.getStakingModule(stakingModulesParams[0].expectedModuleId)
      await assert.revertsWithCustomError(
        router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, module.status, {
          from: appManager,
        }),
        `StakingModuleStatusTheSame()`
      )
    })

    it('set staking module status', async () => {
      const tx = await router.setStakingModuleStatus(
        stakingModulesParams[0].expectedModuleId,
        StakingModuleStatus.Stopped,
        {
          from: appManager,
        }
      )

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.Stopped,
        setBy: appManager,
      })
    })

    it('pause staking module does not allowed without role', async () => {
      await assert.reverts(
        router.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: stranger,
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_PAUSE_ROLE}`
      )
    })

    it('pause staking module does not allowed at not active staking module', async () => {
      await router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager,
      })

      await router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
        from: appManager,
      })
      await assert.revertsWithCustomError(
        router.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager,
        }),
        `StakingModuleNotActive()`
      )
      await router.setStakingModuleStatus(
        stakingModulesParams[0].expectedModuleId,
        StakingModuleStatus.DepositsPaused,
        {
          from: appManager,
        }
      )
      await assert.revertsWithCustomError(
        router.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager,
        }),
        `StakingModuleNotActive()`
      )
    })

    it('pause staking module', async () => {
      await router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager,
      })
      const tx = await router.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
        from: appManager,
      })

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.DepositsPaused,
        setBy: appManager,
      })
    })

    it('deposit fails when module is not active', async () => {
      await assert.revertsWithCustomError(
        router.deposit(100, stakingModulesParams[0].expectedModuleId, '0x00', { value: ETH(32 * 100), from: lido }),
        'StakingModuleNotActive()'
      )
    })

    it('getDepositsAllocation', async () => {
      const keysAllocation = await router.getDepositsAllocation(1000)

      assert.equals(keysAllocation.allocated, 0)
      assert.equals(keysAllocation.allocations, [0, 0])
    })

    it('resume staking module does not allowed without role', async () => {
      await assert.reverts(
        router.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: stranger,
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_RESUME_ROLE}`
      )
    })

    it('resume staking module does not allowed at not paused staking module', async () => {
      await router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
        from: appManager,
      })
      await assert.revertsWithCustomError(
        router.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager,
        }),
        `StakingModuleNotPaused()`
      )
      await router.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager,
      })
      await assert.revertsWithCustomError(
        router.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager,
        }),
        `StakingModuleNotPaused()`
      )
    })

    it('resume staking module', async () => {
      await router.setStakingModuleStatus(
        stakingModulesParams[0].expectedModuleId,
        StakingModuleStatus.DepositsPaused,
        {
          from: appManager,
        }
      )
      const tx = await router.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
        from: appManager,
      })

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.Active,
        setBy: appManager,
      })
    })
  })

  describe('report rewards minted', async () => {
    before(snapshot)
    after(revert)

    it('reverts if no REPORT_REWARDS_MINTED_ROLE role', async () => {
      const stakingModuleIds = [1, 2]
      const totalShares = [300, 400]

      await assert.revertsOZAccessControl(
        router.reportRewardsMinted(stakingModuleIds, totalShares, { from: stranger }),
        stranger,
        'REPORT_REWARDS_MINTED_ROLE'
      )
    })

    it('reverts if stakingModuleIds and totalShares lengths mismatch', async () => {
      const stakingModuleIds = [1, 2, 3]
      const totalShares = [300, 400]

      await router.grantRole(await router.REPORT_REWARDS_MINTED_ROLE(), admin, { from: admin })
      await assert.reverts(
        router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin }),
        `ArraysLengthMismatch`,
        [stakingModuleIds.length, totalShares.length]
      )
    })

    it('reverts if modules are not registered', async () => {
      const stakingModuleIds = [1, 2]
      const totalShares = [300, 400]

      await router.grantRole(await router.REPORT_REWARDS_MINTED_ROLE(), admin, { from: admin })
      await assert.reverts(
        router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin }),
        `StakingModuleUnregistered()`
      )
    })

    it('reverts if modules are not registered', async () => {
      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      await router.addStakingModule(
        'module 2',
        module2.address,
        200, // 2 % _targetShare
        5_000, // 50 % _moduleFee
        0, // 0 % _treasuryFee
        { from: admin }
      )

      const stakingModuleIds = [1, 2]
      const totalShares = [300, 400]

      await router.grantRole(await router.REPORT_REWARDS_MINTED_ROLE(), admin, { from: admin })
      await router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin })

      const module1lastcall = await module1.lastCall_onRewardsMinted()
      assert.equal(+module1lastcall.callCount, 1)
      assert.equal(+module1lastcall.totalShares, 300)

      const module2lastcall = await module2.lastCall_onRewardsMinted()
      assert.equal(+module2lastcall.callCount, 1)
      assert.equal(+module2lastcall.totalShares, 400)
    })

    it("doesn't call onRewardsMinted() on staking module when its share is equal to zero", async () => {
      const stakingModuleIds = [1, 2]
      const totalShares = [500, 0]

      await router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin })

      const module1lastcall = await module1.lastCall_onRewardsMinted()
      assert.equal(+module1lastcall.callCount, 2)
      assert.equal(+module1lastcall.totalShares, 800)

      const module2lastcall = await module2.lastCall_onRewardsMinted()
      assert.equal(+module2lastcall.callCount, 1)
      assert.equal(+module2lastcall.totalShares, 400)
    })

    it('handles reverted staking modules correctly', async () => {
      // staking module will revert with message "UNHANDLED_ERROR"
      const buggedStakingModule = await ContractStub('IStakingModule')
        .on('onRewardsMinted', { revert: { reason: 'UNHANDLED_ERROR' } })
        .create({ from: deployer })

      await router.addStakingModule('Staking Module With Bug', buggedStakingModule.address, 100, 1000, 2000, {
        from: admin,
      })
      const stakingModuleWithBugId = await router.getStakingModulesCount()

      const stakingModuleIds = [1, 2, stakingModuleWithBugId]
      const totalShares = [300, 400, 500]
      await router.grantRole(await router.REPORT_REWARDS_MINTED_ROLE(), admin, { from: admin })
      const tx = await router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin })

      const errorMethodId = '0x08c379a0'
      const errorMessageEncoded = [
        '0000000000000000000000000000000000000000000000000000000000000020',
        '000000000000000000000000000000000000000000000000000000000000000f',
        '554e48414e444c45445f4552524f520000000000000000000000000000000000',
      ]

      assert.emits(tx, 'RewardsMintedReportFailed', {
        stakingModuleId: stakingModuleWithBugId,
        lowLevelRevertData: [errorMethodId, ...errorMessageEncoded].join(''),
      })

      // staking module will revert with out of gas error (revert data is empty bytes)
      await ContractStub(buggedStakingModule)
        .on('onRewardsMinted', { revert: { reason: 'outOfGas' } })
        .update({ from: deployer })

      await assert.reverts(
        router.reportRewardsMinted(stakingModuleIds, totalShares, { from: admin }),
        'UnrecoverableModuleError()'
      )
    })
  })

  describe('updateTargetValidatorsLimits()', () => {
    before(snapshot)
    after(revert)

    it('reverts if no STAKING_MODULE_MANAGE_ROLE role', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const isTargetLimitActive = true
      const targetLimit = 3

      await assert.revertsOZAccessControl(
        router.updateTargetValidatorsLimits(moduleId, nodeOperatorId, isTargetLimitActive, targetLimit, {
          from: stranger,
        }),
        stranger,
        'STAKING_MODULE_MANAGE_ROLE'
      )
    })

    it('reverts if module not register', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const isTargetLimitActive = true
      const targetLimit = 3

      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await assert.reverts(
        router.updateTargetValidatorsLimits(moduleId, nodeOperatorId, isTargetLimitActive, targetLimit, {
          from: admin,
        }),
        'StakingModuleUnregistered()'
      )
    })

    it('update target validators limits works', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const isTargetLimitActive = true
      const targetLimit = 3

      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )

      let lastCall = await module1.lastCall_updateTargetValidatorsLimits()
      assert.equals(lastCall.nodeOperatorId, 0)
      assert.equals(lastCall.isTargetLimitActive, false)
      assert.equals(lastCall.targetLimit, 0)
      assert.equals(lastCall.callCount, 0)

      await router.updateTargetValidatorsLimits(moduleId, nodeOperatorId, isTargetLimitActive, targetLimit, {
        from: admin,
      })

      lastCall = await module1.lastCall_updateTargetValidatorsLimits()
      assert.equals(lastCall.nodeOperatorId, 1)
      assert.equals(lastCall.isTargetLimitActive, true)
      assert.equals(lastCall.targetLimit, targetLimit)
      assert.equals(lastCall.callCount, 1)
    })
  })

  describe('updateRefundedValidatorsCount()', async () => {
    before(snapshot)
    after(revert)

    it('reverts if no STAKING_MODULE_MANAGE_ROLE role', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const refundedValidatorsCount = 3

      await assert.revertsOZAccessControl(
        router.updateRefundedValidatorsCount(moduleId, nodeOperatorId, refundedValidatorsCount, { from: stranger }),
        stranger,
        'STAKING_MODULE_MANAGE_ROLE'
      )
    })

    it('reverts if module not register', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const refundedValidatorsCount = 3

      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await assert.reverts(
        router.updateRefundedValidatorsCount(moduleId, nodeOperatorId, refundedValidatorsCount, { from: admin }),
        'StakingModuleUnregistered()'
      )
    })

    it('update refunded validators works', async () => {
      const moduleId = 1
      const nodeOperatorId = 1
      const refundedValidatorsCount = 3

      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )

      let lastCall = await module1.lastCall_updateRefundedValidatorsCount()
      assert.equal(+lastCall.nodeOperatorId, 0)
      assert.equal(+lastCall.refundedValidatorsCount, 0)
      assert.equal(+lastCall.callCount, 0)

      await router.updateRefundedValidatorsCount(moduleId, nodeOperatorId, refundedValidatorsCount, { from: admin })

      lastCall = await module1.lastCall_updateRefundedValidatorsCount()
      assert.equal(+lastCall.nodeOperatorId, nodeOperatorId)
      assert.equal(+lastCall.refundedValidatorsCount, refundedValidatorsCount)
      assert.equal(+lastCall.callCount, 1)
    })
  })

  describe('getStakingModuleSummary()', async () => {
    before(snapshot)
    after(revert)

    let module1Id

    it('reverts if moduleId does not exists', async () => {
      await assert.reverts(router.getStakingModuleSummary(0), 'StakingModuleUnregistered()')
    })

    it('module id summary works', async () => {
      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      module1Id = +(await router.getStakingModuleIds())[0]

      await module1.setTotalExitedValidatorsCount(11)
      await module1.setActiveValidatorsCount(12)
      await module1.setAvailableKeysCount(33)

      const summary = await router.getStakingModuleSummary(module1Id)
      assert.equal(summary.totalExitedValidators, 11)
      assert.equal(summary.totalDepositedValidators, 23) // 11 exited + 12 deposited
      assert.equal(summary.depositableValidatorsCount, 33)
    })
  })

  describe('getNodeOperatorSummary()', async () => {
    before(snapshot)
    after(revert)

    let module1Id

    it('reverts if moduleId does not exists', async () => {
      await assert.reverts(router.getNodeOperatorSummary(0, 0), 'StakingModuleUnregistered()')
    })

    it('node operator summary by moduleId works', async () => {
      await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
      await router.addStakingModule(
        'module 1',
        module1.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: admin }
      )
      module1Id = +(await router.getStakingModuleIds())[0]

      const summary = {
        isTargetLimitActive: true,
        targetValidatorsCount: 1,
        stuckValidatorsCount: 2,
        refundedValidatorsCount: 3,
        stuckPenaltyEndTimestamp: 4,
        totalExitedValidators: 5,
        totalDepositedValidators: 6,
        depositableValidatorsCount: 7,
      }
      const nodeOperatorId = 0
      await module1.setNodeOperatorSummary(nodeOperatorId, summary)

      const moduleSummary = await router.getNodeOperatorSummary(module1Id, nodeOperatorId)
      assert.equal(moduleSummary.isTargetLimitActive, true)
      assert.equal(moduleSummary.targetValidatorsCount, 1)
      assert.equal(moduleSummary.stuckValidatorsCount, 2)
      assert.equal(moduleSummary.refundedValidatorsCount, 3)
      assert.equal(moduleSummary.stuckPenaltyEndTimestamp, 4)
      assert.equal(moduleSummary.totalExitedValidators, 5)
      assert.equal(moduleSummary.totalDepositedValidators, 6)
      assert.equal(moduleSummary.depositableValidatorsCount, 7)
    })
  })
})
