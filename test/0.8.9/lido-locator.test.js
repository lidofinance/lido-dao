const { assert } = require('../helpers/assert')

const LidoLocator = artifacts.require('LidoLocatorMock')

contract(
  'LidoLocator',
  ([
    lido,
    depositSecurityModule,
    elRewardsVault,
    accountingOracle,
    legacyOracle,
    safetyNetsRegistry,
    selfOwnedStEthBurner,
    stakingRouter,
    treasury,
    validatorExitBus,
    withdrawalQueue,
    withdrawalVault,
    rebaseReceiver,
  ]) => {
    let locator

    before(async () => {
      locator = await LidoLocator.new({
        lido,
        depositSecurityModule,
        elRewardsVault,
        accountingOracle,
        legacyOracle,
        safetyNetsRegistry,
        selfOwnedStEthBurner,
        stakingRouter,
        treasury,
        validatorExitBus,
        withdrawalQueue,
        withdrawalVault,
        rebaseReceiver
      })
    })

    describe('check getters', async () => {
      it('lido()', async () => {
        assert.equals(await locator.lido(), lido)
      })
      it('depositSecurityModule()', async () => {
        assert.equals(await locator.depositSecurityModule(), depositSecurityModule)
      })
      it('elRewardsVault()', async () => {
        assert.equals(await locator.elRewardsVault(), elRewardsVault)
      })
      it('accountingOracle()', async () => {
        assert.equals(await locator.accountingOracle(), accountingOracle)
      })
      it('legacyOracle()', async () => {
        assert.equals(await locator.legacyOracle(), legacyOracle)
      })
      it('safetyNetsRegistry()', async () => {
        assert.equals(await locator.safetyNetsRegistry(), safetyNetsRegistry)
      })
      it('selfOwnedStEthBurner()', async () => {
        assert.equals(await locator.selfOwnedStEthBurner(), selfOwnedStEthBurner)
      })
      it('stakingRouter()', async () => {
        assert.equals(await locator.stakingRouter(), stakingRouter)
      })
      it('treasury()', async () => {
        assert.equals(await locator.treasury(), treasury)
      })
      it('validatorExitBus()', async () => {
        assert.equals(await locator.validatorExitBus(), validatorExitBus)
      })
      it('withdrawalQueue()', async () => {
        assert.equals(await locator.withdrawalQueue(), withdrawalQueue)
      })
      it('withdrawalVault()', async () => {
        assert.equals(await locator.withdrawalVault(), withdrawalVault)
      })
      it('rebaseReceiver()', async () => {
        assert.equals(await locator.rebaseReceiver(), rebaseReceiver)
      })
    })
  }
)
