const { contract, web3 } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { e9, e18, e27 } = require('../../helpers/utils')

const {
  CONSENSUS_VERSION,
  deployAndConfigureAccountingOracle,
  getAccountingReportDataItems,
  encodeExtraDataItems,
  packExtraDataList,
  calcExtraDataListHash,
  calcAccountingReportDataHash,
  EXTRA_DATA_FORMAT_EMPTY,
  EXTRA_DATA_FORMAT_LIST,
  ZERO_HASH,
} = require('./accounting-oracle-deploy.test')

contract('AccountingOracle', ([admin, account1, account2, member1, member2, stranger]) => {
  let consensus = null
  let oracle = null
  let mockLido = null
  let reportItems = null
  let reportFields = null
  let extraDataList = null

  const submitDataRoleKeccak156 = web3.utils.keccak256('SUBMIT_DATA_ROLE')

  const deploy = async ({ emptyExtraData = false } = {}) => {
    const deployed = await deployAndConfigureAccountingOracle(admin)
    const { refSlot } = await deployed.consensus.getCurrentFrame()

    const extraData = {
      stuckKeys: [
        { moduleId: 1, nodeOpIds: [0], keysCounts: [1] },
        { moduleId: 2, nodeOpIds: [0], keysCounts: [2] },
        { moduleId: 3, nodeOpIds: [2], keysCounts: [3] },
      ],
      exitedKeys: [
        { moduleId: 2, nodeOpIds: [1, 2], keysCounts: [1, 3] },
        { moduleId: 3, nodeOpIds: [1], keysCounts: [2] },
      ],
    }

    const extraDataItems = encodeExtraDataItems(extraData)
    extraDataList = packExtraDataList(extraDataItems)
    const extraDataHash = calcExtraDataListHash(extraDataList)

    reportFields = {
      consensusVersion: CONSENSUS_VERSION,
      refSlot: +refSlot,
      numValidators: 10,
      clBalanceGwei: e9(320),
      stakingModuleIdsWithNewlyExitedValidators: [1],
      numExitedValidatorsByStakingModule: [3],
      withdrawalVaultBalance: e18(1),
      elRewardsVaultBalance: e18(2),
      sharesRequestedToBurn: e18(3),
      withdrawalFinalizationBatches: [1],
      simulatedShareRate: e27(1),
      isBunkerMode: true,
      extraDataFormat: emptyExtraData ? EXTRA_DATA_FORMAT_EMPTY : EXTRA_DATA_FORMAT_LIST,
      extraDataHash: emptyExtraData ? ZERO_HASH : extraDataHash,
      extraDataItemsCount: emptyExtraData ? 0 : extraDataItems.length,
    }
    reportItems = getAccountingReportDataItems(reportFields)
    const reportHash = calcAccountingReportDataHash(reportItems)
    await deployed.consensus.addMember(member1, 1, { from: admin })
    await deployed.consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })

    oracle = deployed.oracle
    consensus = deployed.consensus
    mockLido = deployed.mockLido
  }

  context('deploying', () => {
    before(deploy)

    it('deploying accounting oracle', async () => {
      assert.isNotNull(oracle)
      assert.isNotNull(consensus)
      assert.isNotNull(mockLido)
      assert.isNotNull(reportItems)
      assert.isNotNull(extraDataList)
    })
  })

  context('SUBMIT_DATA_ROLE', () => {
    beforeEach(deploy)

    context('submitReportData', () => {
      it('should revert from not consensus member without SUBMIT_DATA_ROLE role', async () => {
        await assert.reverts(
          oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: stranger }),
          'SenderNotAllowed()'
        )
      })

      it('should allow calling from a possessor of SUBMIT_DATA_ROLE role', async () => {
        await oracle.grantRole(submitDataRoleKeccak156, account2)
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await consensus.setTime(deadline)

        const tx = await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: account2 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
      })

      it('should allow calling from a member', async () => {
        const tx = await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: member1 })
        assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
      })
    })

    context('submitReportExtraDataList', () => {
      beforeEach(deploy)

      it('should revert from not consensus member without SUBMIT_DATA_ROLE role ', async () => {
        await assert.reverts(oracle.submitReportExtraDataList(extraDataList, { from: account1 }), 'SenderNotAllowed()')
      })

      it('should allow calling from a possessor of SUBMIT_DATA_ROLE role', async () => {
        await oracle.grantRole(submitDataRoleKeccak156, account2)
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await consensus.setTime(deadline)

        await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: account2 })
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: account2 })

        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })

      it('should allow calling from a member', async () => {
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await consensus.setTime(deadline)

        await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: member1 })
        const tx = await oracle.submitReportExtraDataList(extraDataList, { from: member1 })

        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })

    context('submitReportExtraDataEmpty', () => {
      beforeEach(() => deploy({ emptyExtraData: true }))

      it('should revert from not consensus member without SUBMIT_DATA_ROLE role ', async () => {
        await assert.reverts(oracle.submitReportExtraDataEmpty({ from: account1 }), 'SenderNotAllowed()')
      })

      it('should allow calling from a possessor of SUBMIT_DATA_ROLE role', async () => {
        await oracle.grantRole(submitDataRoleKeccak156, account2)
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await consensus.setTime(deadline)

        await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: account2 })
        const tx = await oracle.submitReportExtraDataEmpty({ from: account2 })

        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })

      it('should allow calling from a member', async () => {
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
        await consensus.setTime(deadline)

        await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: member1 })
        const tx = await oracle.submitReportExtraDataEmpty({ from: member1 })

        assert.emits(tx, 'ExtraDataSubmitted', { refSlot: reportFields.refSlot })
      })
    })
  })
})
