const { assert } = require('chai')

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
    let oracleReportSanityChecker
    let oracleVersion

    async function setup() {
      const deployed = await deployExitBusOracle(admin, {
        lastProcessingRefSlot: LAST_PROCESSING_REF_SLOT,
        resumeAfterDeploy: true
      })

      consensus = deployed.consensus
      oracle = deployed.oracle
      oracleReportSanityChecker = deployed.oracleReportSanityChecker

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

    const getDefaultReportFields = (overrides) => ({
      consensusVersion: CONSENSUS_VERSION,
      dataFormat: DATA_FORMAT_LIST,
      // required override: refSlot
      // required override: requestsCount
      // required override: data
      ...overrides
    })

    async function prepareReportAndSubmitHash(exitRequests, options = {}) {
      const { reportFields: reportFieldsArg = {} } = options
      const { refSlot } = await consensus.getCurrentFrame()

      const reportFields = getDefaultReportFields({
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
        ...reportFieldsArg
      })

      const reportItems = getReportDataItems(reportFields)
      const reportHash = calcReportDataHash(reportItems)

      await triggerConsensusOnHash(reportHash)

      return reportItems
    }

    async function getLastRequestedValidatorIndex(moduleId, nodeOpId) {
      return +(await oracle.getLastRequestedValidatorIndices(moduleId, [nodeOpId]))[0]
    }

    context('_handleConsensusReportData', () => {
      beforeEach(async () => {
        await setup()
        await consensus.advanceTimeToNextFrameStart()
      })

      context('enforces data format', () => {
        it('dataFormat = 0 reverts', async () => {
          const dataFormatUnsupported = 0
          const report = await prepareReportAndSubmitHash(
            [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }],
            { reportFields: { dataFormat: dataFormatUnsupported } }
          )
          await assert.reverts(
            oracle.submitReportData(report, oracleVersion, { from: member1 }),
            `UnsupportedRequestsDataFormat(${dataFormatUnsupported})`
          )
        })

        it('dataFormat = 2 reverts', async () => {
          const dataFormatUnsupported = 2
          const report = await prepareReportAndSubmitHash(
            [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }],
            { reportFields: { dataFormat: dataFormatUnsupported } }
          )
          await assert.reverts(
            oracle.submitReportData(report, oracleVersion, { from: member1 }),
            `UnsupportedRequestsDataFormat(${dataFormatUnsupported})`
          )
        })

        it('dataFormat = 1 pass', async () => {
          const report = await prepareReportAndSubmitHash([
            { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }
          ])
          await oracle.submitReportData(report, oracleVersion, { from: member1 })
        })
      })

      context('enforces data length', () => {
        it('reverts if there is more data than expected', async () => {
          const { refSlot } = await consensus.getCurrentFrame()
          const exitRequests = [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }]
          const reportFields = getDefaultReportFields({
            refSlot: +refSlot,
            requestsCount: exitRequests.length,
            data: encodeExitRequestsDataList(exitRequests)
          })

          reportFields.data += 'aaaaaaaaaaaaaaaaaa'
          const reportItems = getReportDataItems(reportFields)
          const reportHash = calcReportDataHash(reportItems)
          await triggerConsensusOnHash(reportHash)

          await assert.reverts(
            oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
            'InvalidRequestsDataLength()'
          )
        })

        it('reverts if there is less data than expected', async () => {
          const { refSlot } = await consensus.getCurrentFrame()
          const exitRequests = [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }]
          const reportFields = getDefaultReportFields({
            refSlot: +refSlot,
            requestsCount: exitRequests.length,
            data: encodeExitRequestsDataList(exitRequests)
          })

          reportFields.data = reportFields.data.slice(0, reportFields.data.length - 18)
          const reportItems = getReportDataItems(reportFields)
          const reportHash = calcReportDataHash(reportItems)
          await triggerConsensusOnHash(reportHash)

          await assert.reverts(
            oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
            'InvalidRequestsDataLength()'
          )
        })

        it('pass if there is exact amount of data', async () => {
          const report = await prepareReportAndSubmitHash([
            { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }
          ])
          await oracle.submitReportData(report, oracleVersion, { from: member1 })
        })
      })

      context('invokes sanity check', () => {
        it('reverts if request limit is reached', async () => {
          const exitRequestsLimit = 1
          await oracleReportSanityChecker.setMaxExitRequestsPerOracleReport(exitRequestsLimit)
          const report = await prepareReportAndSubmitHash([
            { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] },
            { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] }
          ])
          await assert.reverts(
            oracle.submitReportData(report, oracleVersion, { from: member1 }),
            `IncorrectNumberOfExitRequestsPerReport(${exitRequestsLimit})`
          )
        })

        it('pass if requests amount equals to limit', async () => {
          const exitRequestsLimit = 1
          await oracleReportSanityChecker.setMaxExitRequestsPerOracleReport(exitRequestsLimit)
          const report = await prepareReportAndSubmitHash([
            { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] }
          ])
          await oracle.submitReportData(report, oracleVersion, { from: member1 })
        })
      })

      context('validates data.requestsCount field with given data', () => {
        it('reverts if requestsCount does not match with encoded data size', async () => {
          const report = await prepareReportAndSubmitHash(
            [{ moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] }],
            { reportFields: { requestsCount: 2 } }
          )
          await assert.reverts(
            oracle.submitReportData(report, oracleVersion, { from: member1 }),
            'UnexpectedRequestsDataLength()'
          )
        })
      })
    })

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
  })
})
