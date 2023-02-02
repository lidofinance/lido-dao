const { assert } = require('../helpers/assert')

const LidoLocator = artifacts.require('LidoLocatorMock')

contract(
  'LidoLocator',
  ([
    lido,
    dsm,
    elRewardsVault,
    oracle,
    postTokenRebaseReceiver,
    safetyNetsRegestry,
    selfOwnedStETHBurner,
    stakingRouter,
    treasury,
    withdrawalQueue,
    withdrawalVault
  ]) => {
    let locator

    before(async () => {
      locator = await LidoLocator.new(
        lido,
        dsm,
        elRewardsVault,
        oracle,
        postTokenRebaseReceiver,
        safetyNetsRegestry,
        selfOwnedStETHBurner,
        stakingRouter,
        treasury,
        withdrawalQueue,
        withdrawalVault
      )
    })

    describe('check getters', async () => {
      it('getLido()', async () => {
        assert.equals(await locator.getLido(), lido)
      })
      it('getDepositSecurityModule()', async () => {
        assert.equals(await locator.getDepositSecurityModule(), dsm)
      })
      it('getELRewardsVault()', async () => {
        assert.equals(await locator.getELRewardsVault(), elRewardsVault)
      })
      it('getOracle()', async () => {
        assert.equals(await locator.getOracle(), oracle)
      })
      it('getPostTokenRebaseReceiver()', async () => {
        assert.equals(await locator.getPostTokenRebaseReceiver(), postTokenRebaseReceiver)
      })
      it('getSafetyNetsRegistry()', async () => {
        assert.equals(await locator.getSafetyNetsRegistry(), safetyNetsRegestry)
      })
      it('getSelfOwnedStETHBurner()', async () => {
        assert.equals(await locator.getSelfOwnedStETHBurner(), selfOwnedStETHBurner)
      })
      it('getStakingRouter()', async () => {
        assert.equals(await locator.getStakingRouter(), stakingRouter)
      })
      it('getTreasury()', async () => {
        assert.equals(await locator.getTreasury(), treasury)
      })
      it('getWithdrawalQueue()', async () => {
        assert.equals(await locator.getWithdrawalQueue(), withdrawalQueue)
      })
      it('getWithdrawalVault()', async () => {
        assert.equals(await locator.getWithdrawalVault(), withdrawalVault)
      })
    })
  }
)
