const { assert } = require('../../helpers/assert')
const { contract, artifacts } = require('hardhat')
const { ContractStub } = require('../../helpers/contract-stub')
const { hex, hexConcat } = require('../../helpers/utils')

const StakingRouter = artifacts.require('StakingRouterMock')

const sum = (...items) => items.reduce((s, v) => s + v, 0)
const packNodeOperatorIds = (nodeOperatorIds) => hexConcat(...nodeOperatorIds.map((i) => hex(i, 8)))
const packExitedValidatorCounts = (exitedValidatorsCount) => hexConcat(...exitedValidatorsCount.map((c) => hex(c, 16)))

// Test covers the following scenario:
//    1. round i: oracle reports exited validators by staking module
//    2. round i: oracle reports exited validators by the node operator, but report is incomplete.
//       Simulate a situation when all extra data can't be reported in one transaction
//    3. round i + 1: oracle reports exited validators by staking module
//    4. round i + 1: oracle reports exited validators missing in the first extra data report
contract('StakingRouter :: incomplete exited keys reporting', ([deployer, admin, lidoEOA]) => {
  const deployStakingModuleStub = (firstGetStakingModuleSummary, secondGetStakingModuleSummary) =>
    ContractStub('IStakingModule')
      .frame(0)
      .on('getStakingModuleSummary', {
        return: {
          type: ['uint256', 'uint256', 'uint256'],
          value: Object.values(firstGetStakingModuleSummary),
        },
      })
      .on('updateExitedValidatorsCount', { nextFrame: 1 })

      .frame(1)
      .on('getStakingModuleSummary', {
        return: {
          type: ['uint256', 'uint256', 'uint256'],
          value: Object.values(secondGetStakingModuleSummary),
        },
      })
      .on('updateExitedValidatorsCount')
      .create({ from: deployer })

  const firstStakingModuleId = 1
  const secondStakingModuleId = 2

  const defaultStakingModuleSummaries = {
    [firstStakingModuleId]: {
      totalExitedValidators: 0,
      totalDepositedValidators: 30,
      depositableValidatorsCount: 10,
    },
    [secondStakingModuleId]: {
      totalExitedValidators: 0,
      totalDepositedValidators: 13,
      depositableValidatorsCount: 20,
    },
  }

  // oracle report data for round i
  const firstOracleReport = {
    byStakingModule: { [firstStakingModuleId]: 16, [secondStakingModuleId]: 11 },
    byNodeOperator: {
      [firstStakingModuleId]: { nodeOperatorIds: [1, 2, 3, 4], exitedValidatorsCount: [2, 3, 4, 7] }, // full report
      [secondStakingModuleId]: { nodeOperatorIds: [2, 4], exitedValidatorsCount: [1, 3] }, // partial report
    },
  }

  // oracle report data for round i + 1
  const secondOracleReport = {
    byStakingModule: { [secondStakingModuleId]: 11 },
    byNodeOperator: {
      // deliver missing node operators data
      [secondStakingModuleId]: { nodeOperatorIds: [3, 5, 6, 9], exitedValidatorsCount: [1, 2, 1, 3] },
    },
  }

  let depositContractStub, router, firstStakingModuleStub, secondStakingModuleStub

  before(async () => {
    depositContractStub = await ContractStub('contracts/0.6.11/deposit_contract.sol:IDepositContract').create({
      from: deployer,
    })
    router = await StakingRouter.new(depositContractStub.address, { from: deployer })

    firstStakingModuleStub = await deployStakingModuleStub(
      // return default staking module summary before first oracle report
      defaultStakingModuleSummaries[firstStakingModuleId],
      // after the first report, totalExitedValidators increased by sum of all exited validators
      {
        ...defaultStakingModuleSummaries[firstStakingModuleId],
        totalExitedValidators: sum(
          defaultStakingModuleSummaries[firstStakingModuleId].totalExitedValidators,
          ...firstOracleReport.byNodeOperator[firstStakingModuleId].exitedValidatorsCount
        ),
      }
    )

    secondStakingModuleStub = await deployStakingModuleStub(
      // return default staking module summary before first oracle report
      defaultStakingModuleSummaries[secondStakingModuleId],
      // after the first report, totalExitedValidators increased by sum of all exited validators
      {
        ...defaultStakingModuleSummaries[secondStakingModuleId],
        totalExitedValidators: sum(
          defaultStakingModuleSummaries[secondStakingModuleId].totalExitedValidators,
          ...firstOracleReport.byNodeOperator[secondStakingModuleId].exitedValidatorsCount
        ),
      }
    )

    const wc = '0xff'
    await router.initialize(admin, lidoEOA, wc, { from: deployer })

    await router.grantRole(await router.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), admin, { from: admin })
    await router.grantRole(await router.STAKING_MODULE_PAUSE_ROLE(), admin, { from: admin })
    await router.grantRole(await router.STAKING_MODULE_MANAGE_ROLE(), admin, { from: admin })
    await router.grantRole(await router.REPORT_EXITED_VALIDATORS_ROLE(), admin, { from: admin })

    const addFirstStakingModuleTx = await router.addStakingModule(
      'module stub 1',
      firstStakingModuleStub.address,
      100_00, // target share 100%
      10_00, // module fee 10%
      50_00, // treasury fee 50% from module fee
      { from: admin }
    )

    // validate that actual staking module id equal to expected one
    assert.isTrue(
      addFirstStakingModuleTx.logs.some(
        (e) => e.event === 'StakingModuleAdded' && e.args.stakingModuleId.toString() === firstStakingModuleId.toString()
      )
    )

    const addSecondStakingModuleTx = await router.addStakingModule(
      'module stub 2',
      secondStakingModuleStub.address,
      10_00, // target share 10%
      10_00, // module fee 10%
      0, // treasury fee 0% from module fee
      { from: admin }
    )

    // validate that actual staking module id equal to expected one
    assert.isTrue(
      addSecondStakingModuleTx.logs.some(
        (e) =>
          e.event === 'StakingModuleAdded' && e.args.stakingModuleId.toString() === secondStakingModuleId.toString()
      )
    )
  })

  describe('test', () => {
    it('round i: oracle reports exited validators by staking module', async () => {
      await router.updateExitedValidatorsCountByStakingModule(
        [firstStakingModuleId, secondStakingModuleId],
        [
          firstOracleReport.byStakingModule[firstStakingModuleId],
          firstOracleReport.byStakingModule[secondStakingModuleId],
        ],
        { from: admin }
      )
      const [firstStakingModule, secondStakingModule] = await Promise.all([
        router.getStakingModule(firstStakingModuleId),
        router.getStakingModule(secondStakingModuleId),
      ])
      assert.equals(firstStakingModule.exitedValidatorsCount, firstOracleReport.byStakingModule[firstStakingModuleId])
      assert.equals(secondStakingModule.exitedValidatorsCount, firstOracleReport.byStakingModule[secondStakingModuleId])
    })

    it('round i: oracle reports incompletely exited validators by node operator', async () => {
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(
        firstStakingModuleId,
        packNodeOperatorIds(firstOracleReport.byNodeOperator[firstStakingModuleId].nodeOperatorIds),
        packExitedValidatorCounts(firstOracleReport.byNodeOperator[firstStakingModuleId].exitedValidatorsCount),
        { from: admin }
      )

      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(
        secondStakingModuleId,
        packNodeOperatorIds(firstOracleReport.byNodeOperator[secondStakingModuleId].nodeOperatorIds),
        packExitedValidatorCounts(firstOracleReport.byNodeOperator[secondStakingModuleId].exitedValidatorsCount),
        { from: admin }
      )
    })

    it('round i + 1: oracle reports exited validators by staking module', async () => {
      const tx = await router.updateExitedValidatorsCountByStakingModule(
        [secondStakingModuleId],
        [secondOracleReport.byStakingModule[secondStakingModuleId]],
        { from: admin }
      )

      assert.emits(tx, 'StakingModuleExitedValidatorsIncompleteReporting', {
        stakingModuleId: secondStakingModuleId,
        unreportedExitedValidatorsCount: sum(
          ...secondOracleReport.byNodeOperator[secondStakingModuleId].exitedValidatorsCount
        ),
      })
    })

    it('round i + 1: oracle reports exited validators by node operators completely', async () => {
      await router.reportStakingModuleExitedValidatorsCountByNodeOperator(
        secondStakingModuleId,
        packNodeOperatorIds(secondOracleReport.byNodeOperator[secondStakingModuleId].nodeOperatorIds),
        packExitedValidatorCounts(secondOracleReport.byNodeOperator[secondStakingModuleId].exitedValidatorsCount),
        { from: admin }
      )
    })
  })
})
