const hre = require('hardhat')
const { assert } = require('../helpers/assert')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { utils } = require('web3')
const { ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const LidoLocatorFactory = artifacts.require('LidoLocator.sol')

const DEFAULT_ADMIN_ROLE = '0x0'

contract('LidoLocator', async (accounts) => {
  let evmSnapshotId
  let lidoLocator

  const [
    deployer,
    admin,
    lido,
    depositSecurityModule,
    elRewardsVault,
    oracle,
    postTokenRebaseReceiver,
    safetyNetsRegistry,
    selfOwnedStETHBurner,
    stakingRouter,
    treasury,
    withdrawalQueue,
    withdrawalVault,
    setterAccount,
    newLocatorEntryAddress,
    stranger
  ] = accounts

  const lidoLocatorEntries = [
    {
      name: 'Lido',
      address: lido,
      getter: 'getLido',
      setter: null,
      role: null
    },
    {
      name: 'DepositSecurityModule',
      address: depositSecurityModule,
      getter: 'getDepositSecurityModule',
      setter: 'setDepositSecurityModule',
      role: utils.soliditySha3('SET_DEPOSIT_SECURITY_MODULE_ROLE')
    },
    {
      name: 'ELRewardsVault',
      address: elRewardsVault,
      getter: 'getELRewardsVault',
      setter: 'setELRewardsVault',
      role: utils.soliditySha3('SET_EL_REWARDS_VAULT_ROLE')
    },
    {
      name: 'Oracle',
      address: oracle,
      getter: 'getOracle',
      setter: 'setOracle',
      role: utils.soliditySha3('SET_ORACLE_ROLE')
    },
    {
      name: 'PostTokenRebaseReceiver',
      address: postTokenRebaseReceiver,
      getter: 'getPostTokenRebaseReceiver',
      setter: 'setPostTokenRebaseReceiver',
      role: utils.soliditySha3('SET_POST_TOKEN_REBASE_RECEIVER_ROLE')
    },
    {
      name: 'SafetyNetsRegistry',
      address: safetyNetsRegistry,
      getter: 'getSafetyNetsRegistry',
      setter: 'setSafetyNetsRegistry',
      role: utils.soliditySha3('SET_SAFETY_NETS_REGISTRY_ROLE')
    },
    {
      name: 'SelfOwnedStETHBurner',
      address: selfOwnedStETHBurner,
      getter: 'getSelfOwnedStETHBurner',
      setter: 'setSelfOwnedStETHBurner',
      role: utils.soliditySha3('SET_SELF_OWNED_STETH_BURNER_ROLE')
    },
    {
      name: 'StakingRouter',
      address: stakingRouter,
      getter: 'getStakingRouter',
      setter: 'setStakingRouter',
      role: utils.soliditySha3('SET_STAKING_ROUTER_ROLE')
    },
    {
      name: 'Treasury',
      address: treasury,
      getter: 'getTreasury',
      setter: 'setTreasury',
      role: utils.soliditySha3('SET_TREASURY_ROLE')
    },
    {
      name: 'WithdrawalQueue',
      address: withdrawalQueue,
      getter: 'getWithdrawalQueue',
      setter: 'setWithdrawalQueue',
      role: utils.soliditySha3('SET_WITHDRAWAL_QUEUE_ROLE')
    },
    {
      name: 'WithdrawalVault',
      address: withdrawalVault,
      getter: 'getWithdrawalVault',
      setter: 'setWithdrawalVault',
      role: utils.soliditySha3('SET_WITHDRAWAL_VAULT')
    }
  ]

  before(async () => {
    lidoLocator = await LidoLocatorFactory.new(
      [
        admin,
        lido,
        depositSecurityModule,
        elRewardsVault,
        oracle,
        postTokenRebaseReceiver,
        safetyNetsRegistry,
        selfOwnedStETHBurner,
        stakingRouter,
        treasury,
        withdrawalQueue,
        withdrawalVault
      ],
      { from: deployer }
    )

    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('roles', () => {
    it('sets up admin role', async () => {
      assert(await lidoLocator.hasRole(DEFAULT_ADMIN_ROLE, admin), 'expected admin does not have admin role')
      assertBn(await lidoLocator.getRoleMemberCount(DEFAULT_ADMIN_ROLE), 1, 'unexpected number of admins')
    })
  })

  for (const { name, address, getter, setter, role } of lidoLocatorEntries) {
    describe(`Entry: ${name} address`, async () => {
      it(`initializes ${name} correctly`, async () => {
        const actualAddress = await lidoLocator[getter]()
        assert(actualAddress === address, `expected ${address}, got ${actualAddress}`)
      })

      if (setter) {
        it(`sets a new ${name} address`, async () => {
          await lidoLocator.grantRole(role, setterAccount, { from: admin })
          assert(await lidoLocator.hasRole(role, setterAccount), 'account does not have expected role')

          const accessError = `AccessControl: account ${stranger.toLowerCase()} is missing role ${role}`
          await assert.reverts(lidoLocator[setter](newLocatorEntryAddress, { from: stranger }), accessError)

          const zeroAddressError = 'ErrorZeroAddress()'
          await assert.reverts(lidoLocator[setter](ZERO_ADDRESS, { from: setterAccount }), zeroAddressError)

          const sameAddressError = 'ErrorSameAddress()'
          await assert.reverts(lidoLocator[setter](address, { from: setterAccount }), sameAddressError)

          await lidoLocator[setter](newLocatorEntryAddress, { from: setterAccount })
          const actualAddress = await lidoLocator[getter]()
          assert(actualAddress === newLocatorEntryAddress, `expected ${newLocatorEntryAddress}, got ${actualAddress}`)
        })
      }
    })
  }
})
