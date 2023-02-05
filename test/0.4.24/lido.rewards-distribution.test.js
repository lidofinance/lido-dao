const hre = require('hardhat')

const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const { EvmSnapshot } = require('../helpers/blockchain')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { deployProtocol } = require('../helpers/protocol')
const { assert } = require('../helpers/assert')
const { pushOracleReport } = require('../helpers/oracle')

const ModuleSolo = artifacts.require('ModuleSolo.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
contract('Lido: staking router reward distribution', ([depositor, user2]) => {
  let app, oracle, curatedModule, stakingRouter, soloModule, snapshot, appManager, consensus, treasury


  before(async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol, true)
        const soloModule = await ModuleSolo.new(protocol.pool.address, { from: protocol.appManager.address })
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500
          },
          {
            module: soloModule,
            name: 'Curated',
            targetShares: 5000,
            moduleFee: 566,
            treasuryFee: 123
          }
        ]
      }
    })

    app = deployed.pool
    stakingRouter = deployed.stakingRouter
    curatedModule = deployed.stakingModules[0]
    soloModule = deployed.stakingModules[1]
    consensus = deployed.consensusContract
    oracle = deployed.oracle
    appManager = deployed.appManager.address
    treasury = deployed.treasury.address

    await curatedModule.increaseTotalSigningKeysCount(500_000, { from: appManager })
    await curatedModule.increaseDepositedSigningKeysCount(499_950, { from: appManager })
    await curatedModule.increaseVettedSigningKeysCount(499_950, { from: appManager })

    await soloModule.setTotalKeys(100, { from: appManager })
    await soloModule.setTotalUsedKeys(10, { from: appManager })
    await soloModule.setTotalStoppedKeys(0, { from: appManager })

    snapshot = new EvmSnapshot(hre.ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  it('Rewards distribution fills treasury', async () => {
    const beaconBalance = ETH(1)
    const { stakingModuleFees, totalFee, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()
    const treasuryShare = stakingModuleFees.reduce((total, share) => total.sub(share), totalFee)
    const treasuryRewards = bn(beaconBalance).mul(treasuryShare).div(precisionPoints)
    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const treasuryBalanceBefore = await app.balanceOf(treasury)
    await pushOracleReport(consensus, oracle, 0, beaconBalance)

    const treasuryBalanceAfter = await app.balanceOf(treasury)
    assert(treasuryBalanceAfter.gt(treasuryBalanceBefore))
    assert.equals(fixRound(treasuryBalanceBefore.add(treasuryRewards)), fixRound(treasuryBalanceAfter))
  })

  it('Rewards distribution fills modules', async () => {
    const beaconBalance = ETH(1)
    const { recipients, stakingModuleFees, precisionPoints } = await stakingRouter.getStakingRewardsDistribution()

    await app.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    const moduleBalanceBefore = []
    for (let i = 0; i < recipients.length; i++) {
      moduleBalanceBefore.push(await app.balanceOf(recipients[i]))
    }

    await pushOracleReport(consensus, oracle, 0, beaconBalance)

    for (let i = 0; i < recipients.length; i++) {
      const moduleBalanceAfter = await app.balanceOf(recipients[i])
      const moduleRewards = bn(beaconBalance).mul(stakingModuleFees[i]).div(precisionPoints)
      assert(moduleBalanceAfter.gt(moduleBalanceBefore[i]))
      assert.equals(fixRound(moduleBalanceBefore[i].add(moduleRewards)), fixRound(moduleBalanceAfter))
    }
  })
})

function fixRound(n) {
  const _fix = bn(5) // +/- 5wei
  const _base = bn(10)
  return n.add(_fix).div(_base).mul(_base)
}
