const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { toNum } = require('../../helpers/utils')

const {
  SLOTS_PER_FRAME,
  SECONDS_PER_FRAME,
  computeTimestampAtSlot,
  ZERO_HASH,
  CONSENSUS_VERSION,
  DATA_FORMAT_LIST,
  getValidatorsExitBusReportDataItems,
  calcValidatorsExitBusReportDataHash,
  encodeExitRequestsDataList,
  deployExitBusOracle,
} = require('./validators-exit-bus-oracle-deploy.test')

const PUBKEYS = [
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
]

contract('ValidatorsExitBusOracle', ([admin, member1, member2, member3, stranger]) => {
  context('Happy path', () => {
    const LAST_PROCESSING_REF_SLOT = 1

    let consensus
    let oracle
    let oracleVersion

    let exitRequests
    let reportFields
    let reportItems
    let reportHash

    before(async () => {
      const deployed = await deployExitBusOracle(admin, {
        lastProcessingRefSlot: LAST_PROCESSING_REF_SLOT,
        resumeAfterDeploy: true,
      })

      consensus = deployed.consensus
      oracle = deployed.oracle

      oracleVersion = +(await oracle.getContractVersion())

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 2, { from: admin })
    })

    async function triggerConsensusOnHash(hash) {
      const { refSlot } = await consensus.getCurrentFrame()
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member1 })
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member3 })
      assert.equal((await consensus.getConsensusState()).consensusReport, hash)
    }

    it('initially, consensus report is empty and is not being processed', async () => {
      const report = await oracle.getConsensusReport()
      assert.equal(report.hash, ZERO_HASH)
      // see the next test for refSlot
      assert.equals(report.processingDeadlineTime, 0)
      assert.isFalse(report.processingStarted)

      const frame = await consensus.getCurrentFrame()
      const procState = await oracle.getProcessingState()

      assert.equal(procState.currentFrameRefSlot, +frame.refSlot)
      assert.equal(procState.dataHash, ZERO_HASH)
      assert.equal(procState.processingDeadlineTime, 0)
      assert.isFalse(procState.dataSubmitted)
      assert.equals(procState.dataFormat, 0)
      assert.equals(procState.requestsCount, 0)
      assert.equals(procState.requestsSubmitted, 0)
    })

    it(`reference slot of the empty initial consensus report is set to the last processing slot passed to the initialize function`, async () => {
      const report = await oracle.getConsensusReport()
      assert.equals(report.refSlot, LAST_PROCESSING_REF_SLOT)
    })

    it('committee reaches consensus on a report hash', async () => {
      const { refSlot } = await consensus.getCurrentFrame()

      exitRequests = [
        { moduleId: 1, nodeOpId: 0, valIndex: 0, valPubkey: PUBKEYS[0] },
        { moduleId: 1, nodeOpId: 0, valIndex: 2, valPubkey: PUBKEYS[1] },
        { moduleId: 2, nodeOpId: 0, valIndex: 1, valPubkey: PUBKEYS[2] },
      ]

      reportFields = {
        consensusVersion: CONSENSUS_VERSION,
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        dataFormat: DATA_FORMAT_LIST,
        data: encodeExitRequestsDataList(exitRequests),
      }

      reportItems = getValidatorsExitBusReportDataItems(reportFields)
      reportHash = calcValidatorsExitBusReportDataHash(reportItems)

      await triggerConsensusOnHash(reportHash)
    })

    it('oracle gets the report hash', async () => {
      const report = await oracle.getConsensusReport()
      assert.equal(report.hash, reportHash)
      assert.equals(report.refSlot, +reportFields.refSlot)
      assert.equals(report.processingDeadlineTime, computeTimestampAtSlot(+report.refSlot + SLOTS_PER_FRAME))
      assert.isFalse(report.processingStarted)

      const frame = await consensus.getCurrentFrame()
      const procState = await oracle.getProcessingState()

      assert.equal(procState.currentFrameRefSlot, +frame.refSlot)
      assert.equal(procState.dataHash, reportHash)
      assert.equal(procState.processingDeadlineTime, computeTimestampAtSlot(+frame.reportProcessingDeadlineSlot))
      assert.isFalse(procState.dataSubmitted)
      assert.equals(procState.dataFormat, 0)
      assert.equals(procState.requestsCount, 0)
      assert.equals(procState.requestsSubmitted, 0)
    })

    it('some time passes', async () => {
      await consensus.advanceTimeBy(Math.floor(SECONDS_PER_FRAME / 3))
    })

    it('non-member cannot submit the data', async () => {
      await assert.reverts(
        oracle.submitReportData(reportItems, oracleVersion, { from: stranger }),
        'SenderNotAllowed()'
      )
    })

    it('the data cannot be submitted passing a different contract version', async () => {
      await assert.reverts(
        oracle.submitReportData(reportItems, oracleVersion - 1, { from: member1 }),
        `UnexpectedContractVersion(${oracleVersion}, ${oracleVersion - 1})`
      )
    })

    it('the data cannot be submitted passing a different consensus version', async () => {
      const invalidReport = { ...reportFields, consensusVersion: CONSENSUS_VERSION + 1 }
      await assert.reverts(
        oracle.submitReportData(invalidReport, oracleVersion, { from: member1 }),
        `UnexpectedConsensusVersion(${CONSENSUS_VERSION}, ${CONSENSUS_VERSION + 1})`
      )
    })

    it(`a data not matching the consensus hash cannot be submitted`, async () => {
      const invalidReport = { ...reportFields, requestsCount: reportFields.requestsCount + 1 }
      const invalidReportItems = getValidatorsExitBusReportDataItems(invalidReport)
      const invalidReportHash = calcValidatorsExitBusReportDataHash(invalidReportItems)
      await assert.reverts(
        oracle.submitReportData(invalidReportItems, oracleVersion, { from: member1 }),
        `UnexpectedDataHash("${reportHash}", "${invalidReportHash}")`
      )
    })

    it(`a committee member submits the report data, exit requests are emitted`, async () => {
      const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
      assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
      assert.isTrue((await oracle.getConsensusReport()).processingStarted)

      const timestamp = await oracle.getTime()

      for (let i = 0; i < exitRequests.length; ++i) {
        assert.emitsAt(tx, 'ValidatorExitRequest', i, {
          stakingModuleId: exitRequests[i].moduleId,
          nodeOperatorId: exitRequests[i].nodeOpId,
          validatorIndex: exitRequests[i].valIndex,
          validatorPubkey: exitRequests[i].valPubkey,
          timestamp,
        })
      }
    })

    it(`reports are marked as processed`, async () => {
      const frame = await consensus.getCurrentFrame()
      const procState = await oracle.getProcessingState()

      assert.equal(procState.currentFrameRefSlot, +frame.refSlot)
      assert.equal(procState.dataHash, reportHash)
      assert.equal(procState.processingDeadlineTime, computeTimestampAtSlot(+frame.reportProcessingDeadlineSlot))
      assert.isTrue(procState.dataSubmitted)
      assert.equals(procState.dataFormat, DATA_FORMAT_LIST)
      assert.equals(procState.requestsCount, exitRequests.length)
      assert.equals(procState.requestsSubmitted, exitRequests.length)
    })

    it('last requested validator indices are updated', async () => {
      const indices1 = await oracle.getLastRequestedValidatorIndices(1, [0, 1, 2])
      const indices2 = await oracle.getLastRequestedValidatorIndices(2, [0, 1, 2])
      assert.sameOrderedMembers(toNum(indices1), [2, -1, -1])
      assert.sameOrderedMembers(toNum(indices2), [1, -1, -1])
    })

    it(`no data can be submitted for the same reference slot again`, async () => {
      await assert.reverts(
        oracle.submitReportData(reportItems, oracleVersion, { from: member2 }),
        'RefSlotAlreadyProcessing()'
      )
    })
  })
})
