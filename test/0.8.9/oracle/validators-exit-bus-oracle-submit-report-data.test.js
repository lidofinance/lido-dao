const { assert } = require('../../helpers/assert')

const {
  CONSENSUS_VERSION,
  DATA_FORMAT_LIST,
  getReportDataItems,
  calcReportDataHash,
  encodeExitRequestsDataList,
  deployExitBusOracle
} = require('./validators-exit-bus-oracle-deploy.test')

const PUBKEYS = [
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
]

contract('ValidatorsExitBusOracle', ([admin, member1, member2, member3, stranger]) => {
  context('submitReportData', () => {
    const LAST_PROCESSING_REF_SLOT = 1

    let consensus
    let oracle
    let oracleVersion

    async function setup() {
      const deployed = await deployExitBusOracle(admin, {
        lastProcessingRefSlot: LAST_PROCESSING_REF_SLOT,
        resumeAfterDeploy: true
      })

      consensus = deployed.consensus
      oracle = deployed.oracle

      oracleVersion = +(await oracle.getContractVersion())

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 2, { from: admin })
    }

    async function triggerConsensusOnHash(hash) {
      const { refSlot } = await consensus.getCurrentFrame()
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member1 })
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member3 })
      assert.equal((await consensus.getConsensusState()).consensusReport, hash)
    }

    async function prepareReportAndSubmitHash(
      exitRequests = [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }] // default
    ) {
      const { refSlot } = await consensus.getCurrentFrame()

      const reportFields = {
        consensusVersion: CONSENSUS_VERSION,
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        dataFormat: DATA_FORMAT_LIST,
        data: encodeExitRequestsDataList(exitRequests)
      }

      const reportItems = getReportDataItems(reportFields)
      const reportHash = calcReportDataHash(reportItems)

      await triggerConsensusOnHash(reportHash)

      return reportItems
    }

    async function getLastRequestedValidatorIndex(moduleId, nodeOpId) {
      return +(await oracle.getLastRequestedValidatorIndices(moduleId, [nodeOpId]))[0]
    }

    context(`requires validator indices for the same node operator to increase`, () => {
      before(setup)

      it(`requesting NO 5-3 to exit validator 0`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        assert.equal(await getLastRequestedValidatorIndex(5, 3), 0)
      })

      it(`cannot request NO 5-3 to exit validator 0 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 0, 0)'
        )
      })

      it(`requesting NO 5-3 to exit validator 1`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[1] }
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        assert.equal(await getLastRequestedValidatorIndex(5, 3), 1)
      })

      it(`cannot request NO 5-3 to exit validator 1 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[1] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 1, 1)'
        )
      })

      it(`cannot request NO 5-3 to exit validator 0 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 1, 0)'
        )
      })

      it(`cannot request NO 5-3 to exit validator 1 again (multiple requests)`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 1, valIndex: 10, valPubkey: PUBKEYS[0] },
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[0] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 1, 1)'
        )
      })

      it(`cannot request NO 5-3 to exit validator 1 again (multiple requests, case 2)`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 1, valIndex: 10, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[3] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[4] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 1, 1)'
        )
      })

      it(`cannot request NO 5-3 to exit validator 2 two times per request`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] }
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'InvalidRequestsDataSortOrder()'
        )
      })
    })

    context(`only consensus member or SUBMIT_DATA_ROLE can submit report`, () => {
      beforeEach(setup)

      it('reverts on stranger', async () => {
        const report = await prepareReportAndSubmitHash()
        await assert.reverts(oracle.submitReportData(report, oracleVersion, { from: stranger }), 'SenderNotAllowed()')
      })

      it('SUBMIT_DATA_ROLE is allowed', async () => {
        oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), stranger, { from: admin })
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash()
        await oracle.submitReportData(report, oracleVersion, { from: stranger })
      })

      it('consensus member is allowed', async () => {
        assert(await consensus.getIsMember(member1))
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash()
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
      })
    })

    context('invokes internal baseOracle checks', () => {
      beforeEach(setup)

      it(`reverts on contract version mismatch`, async () => {
        const report = await prepareReportAndSubmitHash()
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion + 1, { from: member1 }),
          `UnexpectedContractVersion(${oracleVersion}, ${oracleVersion + 1})`
        )
      })

      it('reverts on hash mismatch', async () => {
        const report = await prepareReportAndSubmitHash()
        const actualReportHash = calcReportDataHash(report)
        // mess with data field to change hash
        report[report.length - 1] = report[report.length - 1] + 'ff'
        const changedReportHash = calcReportDataHash(report)
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          `UnexpectedDataHash("${actualReportHash}", "${changedReportHash}")`
        )
      })

      it('reverts on processing deadline miss', async () => {
        const report = await prepareReportAndSubmitHash()
        const deadline = (await oracle.getConsensusReport()).processingDeadlineTime.toString(10)
        await consensus.advanceTimeToNextFrameStart()
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          `ProcessingDeadlineMissed(${deadline})`
        )
      })
    })
  })
})
