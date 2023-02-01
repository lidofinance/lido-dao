const hre = require('hardhat')
const { MaxUint256 } = require('@ethersproject/constants')
const { utils } = require('web3')
const { BN } = require('bn.js')
const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')
const { artifacts } = require('hardhat')

const DepositContractMock = artifacts.require('DepositContractMock')
const StakingRouterMock = artifacts.require('StakingRouterMock.sol')
const StakingRouter = artifacts.require('StakingRouter.sol')
const StakingModuleMock = artifacts.require('StakingModuleMock.sol')

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const MANAGE_WITHDRAWAL_CREDENTIALS_ROLE = utils.soliditySha3('MANAGE_WITHDRAWAL_CREDENTIALS_ROLE')
const STAKING_MODULE_PAUSE_ROLE = utils.soliditySha3('STAKING_MODULE_PAUSE_ROLE')
const STAKING_MODULE_RESUME_ROLE = utils.soliditySha3('STAKING_MODULE_RESUME_ROLE')
const STAKING_MODULE_MANAGE_ROLE = utils.soliditySha3('STAKING_MODULE_MANAGE_ROLE')

const UINT24_MAX = new BN(2).pow(new BN(24))

const StakingModuleStatus = {
  Active: 0, // deposits and rewards allowed
  DepositsPaused: 1, // deposits NOT allowed, rewards allowed
  Stopped: 2 // deposits and rewards NOT allowed
}

contract('StakingRouter', (accounts) => {
  let depositContract, app
  const [deployer, lido, admin, appManager, stranger] = accounts
  const wc = '0x'.padEnd(66, '1234')
  const snapshot = new EvmSnapshot(hre.ethers.provider)

  describe('setup env', async () => {
    before(async () => {
      depositContract = await DepositContractMock.new({ from: deployer })
      app = await StakingRouterMock.new(depositContract.address, { from: deployer })
    })

    it('init fails on wrong input', async () => {
      await assert.revertsWithCustomError(app.initialize(ZERO_ADDRESS, lido, wc, { from: deployer }), 'ErrorZeroAddress("_admin")')
      await assert.revertsWithCustomError(app.initialize(admin, ZERO_ADDRESS, wc, { from: deployer }), 'ErrorZeroAddress("_lido")')
    })

    it('initialized correctly', async () => {
      const tx = await app.initialize(admin, lido, wc, { from: deployer })

      assert.equals(await app.getContractVersion(), 1)
      assert.equals(await app.getWithdrawalCredentials(), wc)
      assert.equals(await app.getLido(), lido)
      assert.equals(await app.getStakingModulesCount(), 0)

      assert.equals(await app.getRoleMemberCount(DEFAULT_ADMIN_ROLE), 1)
      assert.equals(await app.hasRole(DEFAULT_ADMIN_ROLE, admin), true)

      assert.equals(tx.logs.length, 3)

      await assert.emits(tx, 'ContractVersionSet', { version: 1 })
      await assert.emits(tx, 'RoleGranted', { role: DEFAULT_ADMIN_ROLE, account: admin, sender: deployer })
      await assert.emits(tx, 'WithdrawalCredentialsSet', { withdrawalCredentials: wc })
    })

    it('second initialize reverts', async () => {
      await assert.revertsWithCustomError(
        app.initialize(admin, lido, wc, { from: deployer }),
        'NonZeroContractVersionOnInit()'
      )
    })

    it('stranger is not allowed to grant roles', async () => {
      await assert.reverts(
        app.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it('grant role MANAGE_WITHDRAWAL_CREDENTIALS_ROLE', async () => {
      const tx = await app.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager, { from: admin })
      assert.equals(await app.getRoleMemberCount(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE), 1)
      assert.equals(await app.hasRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, account: appManager, sender: admin })
    })

    it('grant role STAKING_MODULE_PAUSE_ROLE', async () => {
      const tx = await app.grantRole(STAKING_MODULE_PAUSE_ROLE, appManager, { from: admin })
      assert.equals(await app.getRoleMemberCount(STAKING_MODULE_PAUSE_ROLE), 1)
      assert.equals(await app.hasRole(STAKING_MODULE_PAUSE_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_PAUSE_ROLE, account: appManager, sender: admin })
    })

    it('grant role STAKING_MODULE_RESUME_ROLE', async () => {
      const tx = await app.grantRole(STAKING_MODULE_RESUME_ROLE, appManager, { from: admin })
      assert.equals(await app.getRoleMemberCount(STAKING_MODULE_RESUME_ROLE), 1)
      assert.equals(await app.hasRole(STAKING_MODULE_RESUME_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_RESUME_ROLE, account: appManager, sender: admin })
    })

    it('grant role STAKING_MODULE_MANAGE_ROLE', async () => {
      const tx = await app.grantRole(STAKING_MODULE_MANAGE_ROLE, appManager, { from: admin })
      assert.equals(await app.getRoleMemberCount(STAKING_MODULE_MANAGE_ROLE), 1)
      assert.equals(await app.hasRole(STAKING_MODULE_MANAGE_ROLE, appManager), true)

      assert.equals(tx.logs.length, 1)
      await assert.emits(tx, 'RoleGranted', { role: STAKING_MODULE_MANAGE_ROLE, account: appManager, sender: admin })
    })

    it('public constants', async () => {
      assert.equals(await app.FEE_PRECISION_POINTS(), new BN('100000000000000000000'))
      assert.equals(await app.TOTAL_BASIS_POINTS(), 10000)
      assert.equals(await app.DEPOSIT_CONTRACT(), depositContract.address)
      assert.equals(await app.DEFAULT_ADMIN_ROLE(), DEFAULT_ADMIN_ROLE)
      assert.equals(await app.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), MANAGE_WITHDRAWAL_CREDENTIALS_ROLE)
      assert.equals(await app.STAKING_MODULE_PAUSE_ROLE(), STAKING_MODULE_PAUSE_ROLE)
      assert.equals(await app.STAKING_MODULE_RESUME_ROLE(), STAKING_MODULE_RESUME_ROLE)
      assert.equals(await app.STAKING_MODULE_MANAGE_ROLE(), STAKING_MODULE_MANAGE_ROLE)
    })

    it('getKeysAllocation', async () => {
      const keysAllocation = await app.getKeysAllocation(1000)

      assert.equals(keysAllocation.allocated, 0)
      assert.equals(keysAllocation.allocations, [])
    })
  })

  describe('implementation', async () => {
    let stakingRouterImplementation

    before(async () => {
      await snapshot.make()
      stakingRouterImplementation = await StakingRouter.new(depositContract.address, { from: deployer })
    })

    after(async () => {
      await snapshot.revert()
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

    it('deposit fails', async () => {
      await assert.revertsWithCustomError(
        stakingRouterImplementation.deposit(100, 0, '0x00', { from: stranger }),
        `ErrorAppAuthLidoFailed()`
      )
    })
  })

  describe('staking router', async () => {
    let stakingModule
    before(async () => {
      await snapshot.make()

      stakingModule = await StakingModuleMock.new({ from: deployer })

      await app.addStakingModule('Test module', stakingModule.address, 100, 1000, 2000, {
        from: appManager
      })

      await stakingModule.setAvailableKeysCount(100, { from: deployer })

      assert.equals(await stakingModule.getAvailableKeysCount(), 100)
    })

    after(async () => {
      await snapshot.revert()
    })

    it('set withdrawal credentials does not allowed without role', async () => {
      const newWC = '0x'.padEnd(66, '5678')
      await assert.reverts(
        app.setWithdrawalCredentials(newWC, { from: stranger }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${MANAGE_WITHDRAWAL_CREDENTIALS_ROLE}`
      )
    })

    it('set withdrawal credentials', async () => {
      const newWC = '0x'.padEnd(66, '5678')
      const tx = await app.setWithdrawalCredentials(newWC, { from: appManager })

      await assert.emits(tx, 'WithdrawalCredentialsSet', { withdrawalCredentials: newWC })

      assert.equals(await stakingModule.getAvailableKeysCount(), 0)
    })

    it('direct transfer fails', async () => {
      const value = 100
      await assert.revertsWithCustomError(app.sendTransaction({ value, from: deployer }), `ErrorDirectETHTransfer()`)
    })

    it('getStakingModuleKeysOpIndex', async () => {
      await stakingModule.setValidatorsKeysNonce(100, { from: deployer })

      assert.equals(await app.getStakingModuleKeysOpIndex(1), 100)
    })

    it('getStakingModuleKeysOpIndex reverts when staking module id too large', async () => {
      await assert.revertsWithCustomError(app.getStakingModuleKeysOpIndex(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
    })

    it('getStakingModuleLastDepositBlock reverts when staking module id too large', async () => {
      await assert.revertsWithCustomError(app.getStakingModuleLastDepositBlock(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
    })

    it('getStakingModuleActiveKeysCount reverts when staking module id too large', async () => {
      await assert.revertsWithCustomError(app.getStakingModuleActiveKeysCount(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
    })

    it('getStakingModuleActiveKeysCount', async () => {
      await stakingModule.setActiveKeysCount(200, { from: deployer })

      assert.equals(await app.getStakingModuleActiveKeysCount(1), 200)
    })

    it('getStakingRewardsDistribution', async () => {
      const anotherStakingModule = await StakingModuleMock.new({ from: deployer })

      await app.addStakingModule('Test module 2', anotherStakingModule.address, 100, 1000, 2000, {
        from: appManager
      })

      await app.getStakingRewardsDistribution()
    })

    it('getStakingModuleIndexById zero index fail', async () => {
      await assert.revertsWithCustomError(app.getStakingModuleIndexById(0), 'ErrorStakingModuleUnregistered()')
    })
  })

  describe('staking modules limit', async () => {
    before(async () => {
      await snapshot.make()
    })

    after(async () => {
      await snapshot.revert()
    })
    it('staking modules limit is 32', async () => {
      const stakingModule = await StakingModuleMock.new({ from: deployer })
      for (var i = 0; i < 32; i++) {
        await app.addStakingModule('Test module', stakingModule.address, 100, 100, 100, { from: appManager })
      }
      await assert.revertsWithCustomError(
        app.addStakingModule('Test module', stakingModule.address, 100, 100, 100, { from: appManager }),
        `ErrorStakingModulesLimitExceeded()`
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
        address: null
      },
      {
        name: 'Test module 1',
        targetShare: 1000,
        stakingModuleFee: 2000,
        treasuryFee: 200,
        expectedModuleId: 2,
        address: null
      }
    ]

    before(async () => {
      await snapshot.make()

      stakingModule1 = await StakingModuleMock.new({ from: deployer })
      stakingModule2 = await StakingModuleMock.new({ from: deployer })

      stakingModulesParams[0].address = stakingModule1.address
      stakingModulesParams[1].address = stakingModule2.address
    })

    after(async () => {
      await snapshot.revert()
    })

    it('addStakingModule call is not allowed from stranger', async () => {
      await assert.reverts(
        app.addStakingModule(
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
        app.addStakingModule(
          stakingModulesParams[0].name,
          stakingModule1.address,
          10001,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          { from: appManager }
        ),
        `ErrorValueOver100Percent("_targetShare")`
      )
    })

    it('addStakingModule fails on fees > 100%', async () => {
      await assert.revertsWithCustomError(
        app.addStakingModule(stakingModulesParams[0].name, stakingModule1.address, stakingModulesParams[0].targetShare, 5000, 5001, {
          from: appManager
        }),
        `ErrorValueOver100Percent("_stakingModuleFee + _treasuryFee")`
      )
    })

    it('addStakingModule fails on zero address', async () => {
      await assert.revertsWithCustomError(
        app.addStakingModule(
          stakingModulesParams[0].name,
          ZERO_ADDRESS,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager
          }
        ),
        `ErrorZeroAddress("_stakingModuleAddress")`
      )
    })

    it('addStakingModule fails on incorrect module name', async () => {
      // check zero length
      await assert.revertsWithCustomError(
        app.addStakingModule(
          '',
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager
          }
        ),
        `ErrorStakingModuleWrongName()`
      )

      // check length > 32 symbols
      await assert.revertsWithCustomError(
        app.addStakingModule(
          '#'.repeat(33),
          stakingModule1.address,
          stakingModulesParams[0].targetShare,
          stakingModulesParams[0].stakingModuleFee,
          stakingModulesParams[0].treasuryFee,
          {
            from: appManager
          }
        ),
        `ErrorStakingModuleWrongName()`
      )
    })

    it('add staking module', async () => {
      const tx = await app.addStakingModule(
        stakingModulesParams[0].name,
        stakingModule1.address,
        stakingModulesParams[0].targetShare,
        stakingModulesParams[0].stakingModuleFee,
        stakingModulesParams[0].treasuryFee,
        {
          from: appManager
        }
      )
      assert.equals(tx.logs.length, 3)
      await assert.emits(tx, 'StakingModuleAdded', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        stakingModule: stakingModule1.address,
        name: stakingModulesParams[0].name,
        createdBy: appManager
      })
      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        targetShare: stakingModulesParams[0].targetShare,
        setBy: appManager
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        stakingModuleFee: stakingModulesParams[0].stakingModuleFee,
        treasuryFee: stakingModulesParams[0].treasuryFee,
        setBy: appManager
      })

      assert.equals(await app.getStakingModulesCount(), 1)
      assert.equals(await app.getStakingModuleStatus(stakingModulesParams[0].expectedModuleId), StakingModuleStatus.Active)
      assert.equals(await app.getStakingModuleIsStopped(stakingModulesParams[0].expectedModuleId), false)
      assert.equals(await app.getStakingModuleIsDepositsPaused(stakingModulesParams[0].expectedModuleId), false)
      assert.equals(await app.getStakingModuleIsActive(stakingModulesParams[0].expectedModuleId), true)

      await assert.revertsWithCustomError(app.getStakingModule(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
      await assert.revertsWithCustomError(app.getStakingModuleStatus(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
      await assert.revertsWithCustomError(app.getStakingModuleIsStopped(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
      await assert.revertsWithCustomError(app.getStakingModuleIsDepositsPaused(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')
      await assert.revertsWithCustomError(app.getStakingModuleIsActive(UINT24_MAX), 'ErrorStakingModuleIdTooLarge()')

      const module = await app.getStakingModule(stakingModulesParams[0].expectedModuleId)

      assert.equals(module.name, stakingModulesParams[0].name)
      assert.equals(module.stakingModuleAddress, stakingModule1.address)
      assert.equals(module.stakingModuleFee, stakingModulesParams[0].stakingModuleFee)
      assert.equals(module.treasuryFee, stakingModulesParams[0].treasuryFee)
      assert.equals(module.targetShare, stakingModulesParams[0].targetShare)
      assert.equals(module.status, StakingModuleStatus.Active)
      assert.equals(module.lastDepositAt, 0)
      assert.equals(module.lastDepositBlock, 0)
    })

    it('add another staking module', async () => {
      const tx = await app.addStakingModule(
        stakingModulesParams[1].name,
        stakingModule2.address,
        stakingModulesParams[1].targetShare,
        stakingModulesParams[1].stakingModuleFee,
        stakingModulesParams[1].treasuryFee,
        {
          from: appManager
        }
      )

      assert.equals(tx.logs.length, 3)
      await assert.emits(tx, 'StakingModuleAdded', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        stakingModule: stakingModule2.address,
        name: stakingModulesParams[1].name,
        createdBy: appManager
      })
      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        targetShare: stakingModulesParams[1].targetShare,
        setBy: appManager
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModulesParams[1].expectedModuleId,
        stakingModuleFee: stakingModulesParams[1].stakingModuleFee,
        treasuryFee: stakingModulesParams[1].treasuryFee,
        setBy: appManager
      })

      assert.equals(await app.getStakingModulesCount(), 2)
      assert.equals(await app.getStakingModuleStatus(stakingModulesParams[1].expectedModuleId), StakingModuleStatus.Active)
      assert.equals(await app.getStakingModuleIsStopped(stakingModulesParams[1].expectedModuleId), false)
      assert.equals(await app.getStakingModuleIsDepositsPaused(stakingModulesParams[1].expectedModuleId), false)
      assert.equals(await app.getStakingModuleIsActive(stakingModulesParams[1].expectedModuleId), true)

      const module = await app.getStakingModule(stakingModulesParams[1].expectedModuleId)

      assert.equals(module.name, stakingModulesParams[1].name)
      assert.equals(module.stakingModuleAddress, stakingModule2.address)
      assert.equals(module.stakingModuleFee, stakingModulesParams[1].stakingModuleFee)
      assert.equals(module.treasuryFee, stakingModulesParams[1].treasuryFee)
      assert.equals(module.targetShare, stakingModulesParams[1].targetShare)
      assert.equals(module.status, StakingModuleStatus.Active)
      assert.equals(module.lastDepositAt, 0)
      assert.equals(module.lastDepositBlock, 0)
    })

    it('get staking modules list', async () => {
      const stakingModules = await app.getStakingModules()

      for (let i = 0; i < 2; i++) {
        assert.equals(stakingModules[i].name, stakingModulesParams[i].name)
        assert.equals(stakingModules[i].stakingModuleAddress, stakingModulesParams[i].address)
        assert.equals(stakingModules[i].stakingModuleFee, stakingModulesParams[i].stakingModuleFee)
        assert.equals(stakingModules[i].treasuryFee, stakingModulesParams[i].treasuryFee)
        assert.equals(stakingModules[i].targetShare, stakingModulesParams[i].targetShare)
        assert.equals(stakingModules[i].status, StakingModuleStatus.Active)
        assert.equals(stakingModules[i].lastDepositAt, 0)
        assert.equals(stakingModules[i].lastDepositBlock, 0)
      }
    })

    it('get staking module ids', async () => {
      const stakingModules = await app.getStakingModules()
      const stakingModuleIds = await app.getStakingModuleIds()

      for (let i = 0; i < stakingModules.length; i++) {
        assert.equals(stakingModules[i].id, stakingModuleIds[i])
      }
    })

    it('update staking module does not allowed without role', async () => {
      await assert.reverts(
        app.updateStakingModule(
          stakingModulesParams[0].expectedModuleId,
          stakingModulesParams[0].targetShare + 1,
          stakingModulesParams[0].stakingModuleFee + 1,
          stakingModulesParams[0].treasuryFee + 1,
          {
            from: stranger
          }
        ),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_MANAGE_ROLE}`
      )
    })

    it('update staking module reverts on large module id', async () => {
      await assert.revertsWithCustomError(
        app.updateStakingModule(
          UINT24_MAX,
          stakingModulesParams[0].targetShare + 1,
          stakingModulesParams[0].stakingModuleFee + 1,
          stakingModulesParams[0].treasuryFee + 1,
          {
            from: appManager
          }
        ),
        `ErrorStakingModuleIdTooLarge()`
      )
    })

    it('update staking module fails on target share > 100%', async () => {
      await assert.revertsWithCustomError(
        app.updateStakingModule(
          stakingModulesParams[0].expectedModuleId,
          10001,
          stakingModulesParams[0].stakingModuleFee + 1,
          stakingModulesParams[0].treasuryFee + 1,
          {
            from: appManager
          }
        ),
        `ErrorValueOver100Percent("_targetShare")`
      )
    })

    it('update staking module fails on fees > 100%', async () => {
      await assert.revertsWithCustomError(
        app.updateStakingModule(stakingModulesParams[0].expectedModuleId, stakingModulesParams[0].targetShare + 1, 5000, 5001, {
          from: appManager
        }),
        `ErrorValueOver100Percent("_stakingModuleFee + _treasuryFee")`
      )
    })

    it('update staking module', async () => {
      const stakingModuleNewParams = {
        id: stakingModulesParams[0].expectedModuleId,
        targetShare: stakingModulesParams[0].targetShare + 1,
        stakingModuleFee: stakingModulesParams[0].stakingModuleFee + 1,
        treasuryFee: stakingModulesParams[0].treasuryFee + 1
      }

      const tx = await app.updateStakingModule(
        stakingModuleNewParams.id,
        stakingModuleNewParams.targetShare,
        stakingModuleNewParams.stakingModuleFee,
        stakingModuleNewParams.treasuryFee,
        {
          from: appManager
        }
      )

      assert.equals(tx.logs.length, 2)

      await assert.emits(tx, 'StakingModuleTargetShareSet', {
        stakingModuleId: stakingModuleNewParams.id,
        targetShare: stakingModuleNewParams.targetShare,
        setBy: appManager
      })
      await assert.emits(tx, 'StakingModuleFeesSet', {
        stakingModuleId: stakingModuleNewParams.id,
        stakingModuleFee: stakingModuleNewParams.stakingModuleFee,
        treasuryFee: stakingModuleNewParams.treasuryFee,
        setBy: appManager
      })
    })

    it('set staking module status does not allowed without role', async () => {
      await assert.reverts(
        app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
          from: stranger
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_MANAGE_ROLE}`
      )
    })

    it('set staking module status reverts if staking module id too large', async () => {
      await assert.revertsWithCustomError(
        app.setStakingModuleStatus(UINT24_MAX, StakingModuleStatus.Stopped, {
          from: appManager
        }),
        `ErrorStakingModuleIdTooLarge()`
      )
    })

    it('set staking module status reverts if status is the same', async () => {
      const module = await app.getStakingModule(stakingModulesParams[0].expectedModuleId)
      await assert.revertsWithCustomError(
        app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, module.status, {
          from: appManager
        }),
        `ErrorStakingModuleStatusTheSame()`
      )
    })

    it('set staking module status', async () => {
      const tx = await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
        from: appManager
      })

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.Stopped,
        setBy: appManager
      })
    })

    it('pause staking module does not allowed without role', async () => {
      await assert.reverts(
        app.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: stranger
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_PAUSE_ROLE}`
      )
    })

    it('pause staking module reverts when staking module too large', async () => {
      await assert.revertsWithCustomError(
        app.pauseStakingModule(UINT24_MAX, {
          from: appManager
        }),
        `ErrorStakingModuleIdTooLarge()`
      )
    })

    it('pause staking module does not allowed at not active staking module', async () => {
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager
      })

      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
        from: appManager
      })
      await assert.revertsWithCustomError(
        app.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager
        }),
        `ErrorStakingModuleNotActive()`
      )
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.DepositsPaused, {
        from: appManager
      })
      await assert.revertsWithCustomError(
        app.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager
        }),
        `ErrorStakingModuleNotActive()`
      )
    })

    it('pause staking module', async () => {
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager
      })
      const tx = await app.pauseStakingModule(stakingModulesParams[0].expectedModuleId, {
        from: appManager
      })

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.DepositsPaused,
        setBy: appManager
      })
    })

    it('deposit fails', async () => {
      await assert.revertsWithCustomError(
        app.deposit(100, UINT24_MAX, '0x00', { value: 100, from: lido }),
        'ErrorStakingModuleIdTooLarge()'
      )
    })

    it('deposit fails', async () => {
      await assert.revertsWithCustomError(
        app.deposit(100, stakingModulesParams[0].expectedModuleId, '0x00', { value: 100, from: lido }),
        'ErrorStakingModuleNotActive()'
      )
    })

    it('getKeysAllocation', async () => {
      const keysAllocation = await app.getKeysAllocation(1000)

      assert.equals(keysAllocation.allocated, 0)
      assert.equals(keysAllocation.allocations, [0, 0])
    })

    it('resume staking module does not allowed without role', async () => {
      await assert.reverts(
        app.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: stranger
        }),
        `AccessControl: account ${stranger.toLowerCase()} is missing role ${STAKING_MODULE_RESUME_ROLE}`
      )
    })

    it('resume staking module reverts when staking module id too large', async () => {
      await assert.revertsWithCustomError(
        app.resumeStakingModule(UINT24_MAX, {
          from: appManager
        }),
        `ErrorStakingModuleIdTooLarge()`
      )
    })

    it('resume staking module does not allowed at not paused staking module', async () => {
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Stopped, {
        from: appManager
      })
      await assert.revertsWithCustomError(
        app.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager
        }),
        `ErrorStakingModuleNotPaused()`
      )
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.Active, {
        from: appManager
      })
      await assert.revertsWithCustomError(
        app.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
          from: appManager
        }),
        `ErrorStakingModuleNotPaused()`
      )
    })

    it('resume staking module', async () => {
      await app.setStakingModuleStatus(stakingModulesParams[0].expectedModuleId, StakingModuleStatus.DepositsPaused, {
        from: appManager
      })
      const tx = await app.resumeStakingModule(stakingModulesParams[0].expectedModuleId, {
        from: appManager
      })

      await assert.emits(tx, 'StakingModuleStatusSet', {
        stakingModuleId: stakingModulesParams[0].expectedModuleId,
        status: StakingModuleStatus.Active,
        setBy: appManager
      })
    })
  })
})
