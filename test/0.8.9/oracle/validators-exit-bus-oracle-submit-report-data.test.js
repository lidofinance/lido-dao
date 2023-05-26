const { contract, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const {
  CONSENSUS_VERSION,
  DATA_FORMAT_LIST,
  getValidatorsExitBusReportDataItems,
  calcValidatorsExitBusReportDataHash,
  encodeExitRequestsDataList,
  deployExitBusOracle,
  computeTimestampAtSlot,
  ZERO_HASH,
} = require('./validators-exit-bus-oracle-deploy.test')

const ValidatorExitBusAbi = require('../../../lib/abi/ValidatorsExitBusOracle.json')
const { HASH_1 } = require('./hash-consensus-deploy.test')

const PUBKEYS = [
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
]

function assertEqualsObject(state, desired) {
  for (const key in desired) {
    if (Object.hasOwnProperty.call(desired, key)) {
      assert.equals(state[key], desired[key], key)
    }
  }
}

contract('ValidatorsExitBusOracle', ([admin, member1, member2, member3, stranger]) => {
  context('submitReportData', () => {
    const LAST_PROCESSING_REF_SLOT = 1

    let consensus
    let oracle
    let oracleReportSanityChecker
    let oracleVersion
    let snapshot

    async function deployAndSetup() {
      snapshot = new EvmSnapshot(ethers.provider)
      const deployed = await deployExitBusOracle(admin, {
        lastProcessingRefSlot: LAST_PROCESSING_REF_SLOT,
        resumeAfterDeploy: true,
      })

      consensus = deployed.consensus
      oracle = deployed.oracle
      oracleReportSanityChecker = deployed.oracleReportSanityChecker

      oracleVersion = +(await oracle.getContractVersion())

      await consensus.addMember(member1, 1, { from: admin })
      await consensus.addMember(member2, 2, { from: admin })
      await consensus.addMember(member3, 2, { from: admin })
      await snapshot.make()
    }

    async function rollback() {
      await snapshot.rollback()
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
      ...overrides,
    })

    async function prepareReportAndSubmitHash(
      exitRequests = [{ moduleId: 5, nodeOpId: 1, valIndex: 10, valPubkey: PUBKEYS[2] }],
      options = {}
    ) {
      const { reportFields: reportFieldsArg = {} } = options
      const { refSlot } = await consensus.getCurrentFrame()

      const reportFields = getDefaultReportFields({
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
        ...reportFieldsArg,
      })

      const reportItems = getValidatorsExitBusReportDataItems(reportFields)
      const reportHash = calcValidatorsExitBusReportDataHash(reportItems)

      await triggerConsensusOnHash(reportHash)

      return reportItems
    }

    async function getLastRequestedValidatorIndex(moduleId, nodeOpId) {
      return +(await oracle.getLastRequestedValidatorIndices(moduleId, [nodeOpId]))[0]
    }

    before(deployAndSetup)

    context('discarded report prevents data submit', () => {
      let reportItems = null
      let reportHash = null

      after(rollback)

      it('report is discarded', async () => {
        reportItems = await prepareReportAndSubmitHash()
        reportHash = calcValidatorsExitBusReportDataHash(reportItems)
        const { refSlot } = await consensus.getCurrentFrame()

        // change of mind
        const tx = await consensus.submitReport(refSlot, HASH_1, CONSENSUS_VERSION, { from: member3 })
        assert.emits(tx, 'ReportDiscarded', { refSlot, hash: reportHash }, { abi: ValidatorExitBusAbi })
      })

      it('processing state reverts to pre-report state ', async () => {
        const state = await oracle.getProcessingState()
        assert.equals(state.dataHash, ZERO_HASH)
        assert.equals(state.dataSubmitted, false)
        assert.equals(state.dataFormat, 0)
        assert.equals(state.requestsCount, 0)
        assert.equals(state.requestsSubmitted, 0)
      })

      it('reverts on trying to submit the discarded report', async () => {
        await assert.reverts(
          oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
          `UnexpectedDataHash`,
          [`"${ZERO_HASH}"`, `"${reportHash}"`]
        )
      })
    })

    context('_handleConsensusReportData', () => {
      beforeEach(async () => {
        await consensus.advanceTimeToNextFrameStart()
      })

      afterEach(rollback)

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
            { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
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
            data: encodeExitRequestsDataList(exitRequests),
          })

          reportFields.data += 'aaaaaaaaaaaaaaaaaa'
          const reportItems = getValidatorsExitBusReportDataItems(reportFields)
          const reportHash = calcValidatorsExitBusReportDataHash(reportItems)
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
            data: encodeExitRequestsDataList(exitRequests),
          })

          reportFields.data = reportFields.data.slice(0, reportFields.data.length - 18)
          const reportItems = getValidatorsExitBusReportDataItems(reportFields)
          const reportHash = calcValidatorsExitBusReportDataHash(reportItems)
          await triggerConsensusOnHash(reportHash)

          await assert.reverts(
            oracle.submitReportData(reportItems, oracleVersion, { from: member1 }),
            'InvalidRequestsDataLength()'
          )
        })

        it('pass if there is exact amount of data', async () => {
          const report = await prepareReportAndSubmitHash([
            { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
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
            { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] },
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
            { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] },
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

      it('reverts if moduleId equals zero', async () => {
        const report = await prepareReportAndSubmitHash([
          { moduleId: 0, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
        ])
        await assert.reverts(oracle.submitReportData(report, oracleVersion, { from: member1 }), 'InvalidRequestsData()')
      })

      it('emits ValidatorExitRequest events', async () => {
        const requests = [
          { moduleId: 4, nodeOpId: 2, valIndex: 2, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] },
        ]
        const report = await prepareReportAndSubmitHash(requests)
        const tx = await oracle.submitReportData(report, oracleVersion, { from: member1 })
        const timestamp = await consensus.getTime()

        assert.emits(tx, 'ValidatorExitRequest', {
          stakingModuleId: requests[0].moduleId,
          nodeOperatorId: requests[0].nodeOpId,
          validatorIndex: requests[0].valIndex,
          validatorPubkey: requests[0].valPubkey,
          timestamp,
        })

        assert.emits(tx, 'ValidatorExitRequest', {
          stakingModuleId: requests[1].moduleId,
          nodeOperatorId: requests[1].nodeOpId,
          validatorIndex: requests[1].valIndex,
          validatorPubkey: requests[1].valPubkey,
          timestamp,
        })
      })

      it('updates processing state', async () => {
        const storageBefore = await oracle.getDataProcessingState()
        assert.equals(storageBefore.refSlot, 0)
        assert.equals(storageBefore.requestsCount, 0)
        assert.equals(storageBefore.requestsProcessed, 0)
        assert.equals(storageBefore.dataFormat, 0)

        const { refSlot } = await consensus.getCurrentFrame()
        const requests = [
          { moduleId: 4, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] },
        ]
        const report = await prepareReportAndSubmitHash(requests)
        await oracle.submitReportData(report, oracleVersion, { from: member1 })

        const storageAfter = await oracle.getDataProcessingState()
        assert.equals(storageAfter.refSlot, +refSlot)
        assert.equals(storageAfter.requestsCount, requests.length)
        assert.equals(storageAfter.requestsProcessed, requests.length)
        assert.equals(storageAfter.dataFormat, DATA_FORMAT_LIST)
      })

      it('updates total requests processed count', async () => {
        let currentCount = 0
        const countStep0 = await oracle.getTotalRequestsProcessed()
        assert.equals(countStep0, currentCount)

        // Step 1 — process 1 item
        const requestsStep1 = [{ moduleId: 3, nodeOpId: 1, valIndex: 2, valPubkey: PUBKEYS[1] }]
        const reportStep1 = await prepareReportAndSubmitHash(requestsStep1)
        await oracle.submitReportData(reportStep1, oracleVersion, { from: member1 })
        const countStep1 = await oracle.getTotalRequestsProcessed()
        currentCount += requestsStep1.length
        assert.equals(countStep1, currentCount)

        // Step 2 — process 2 items
        await consensus.advanceTimeToNextFrameStart()
        const requestsStep2 = [
          { moduleId: 4, nodeOpId: 2, valIndex: 2, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] },
        ]
        const reportStep2 = await prepareReportAndSubmitHash(requestsStep2)
        await oracle.submitReportData(reportStep2, oracleVersion, { from: member1 })
        const countStep2 = await oracle.getTotalRequestsProcessed()
        currentCount += requestsStep2.length
        assert.equals(countStep2, currentCount)

        // Step 3 — process no items
        await consensus.advanceTimeToNextFrameStart()
        const requestsStep3 = []
        const reportStep3 = await prepareReportAndSubmitHash(requestsStep3)
        await oracle.submitReportData(reportStep3, oracleVersion, { from: member1 })
        const countStep3 = await oracle.getTotalRequestsProcessed()
        currentCount += requestsStep3.length
        assert.equals(countStep3, currentCount)
      })
    })

    context(`requires validator indices for the same node operator to increase`, () => {
      after(rollback)

      it(`requesting NO 5-3 to exit validator 0`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        assert.equal(await getLastRequestedValidatorIndex(5, 3), 0)
      })

      it(`cannot request NO 5-3 to exit validator 0 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 0, 0)'
        )
      })

      it(`requesting NO 5-3 to exit validator 1`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[1] },
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        assert.equal(await getLastRequestedValidatorIndex(5, 3), 1)
      })

      it(`cannot request NO 5-3 to exit validator 1 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[1] },
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'NodeOpValidatorIndexMustIncrease(5, 3, 1, 1)'
        )
      })

      it(`cannot request NO 5-3 to exit validator 0 again`, async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
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
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[0] },
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
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[4] },
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
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[3] },
        ])
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion, { from: member1 }),
          'InvalidRequestsDataSortOrder()'
        )
      })
    })

    context(`only consensus member or SUBMIT_DATA_ROLE can submit report on unpaused contract`, () => {
      afterEach(rollback)

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

      it('reverts on paused contract', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const PAUSE_INFINITELY = await oracle.PAUSE_INFINITELY()
        await oracle.pauseFor(PAUSE_INFINITELY, { from: admin })
        const report = await prepareReportAndSubmitHash()
        assert.reverts(oracle.submitReportData(report, oracleVersion, { from: member1 }), 'ResumedExpected()')
      })
    })

    context('invokes internal baseOracle checks', () => {
      afterEach(rollback)

      it(`reverts on contract version mismatch`, async () => {
        const report = await prepareReportAndSubmitHash()
        await assert.reverts(
          oracle.submitReportData(report, oracleVersion + 1, { from: member1 }),
          `UnexpectedContractVersion(${oracleVersion}, ${oracleVersion + 1})`
        )
      })

      it('reverts on hash mismatch', async () => {
        const report = await prepareReportAndSubmitHash()
        const actualReportHash = calcValidatorsExitBusReportDataHash(report)
        // mess with data field to change hash
        report[report.length - 1] = report[report.length - 1] + 'ff'
        const changedReportHash = calcValidatorsExitBusReportDataHash(report)
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

    context('getTotalRequestsProcessed reflects report history', () => {
      after(rollback)

      let requestCount

      it('should be zero at init', async () => {
        requestCount = 0
        assert.equals(await oracle.getTotalRequestsProcessed(), requestCount)
      })

      it('should increase after report', async () => {
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 3, valIndex: 0, valPubkey: PUBKEYS[0] },
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        requestCount += 1
        assert.equals(await oracle.getTotalRequestsProcessed(), requestCount)
      })

      it('should double increase for two exits', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 1, valIndex: 10, valPubkey: PUBKEYS[0] },
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[0] },
        ])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        requestCount += 2
        assert.equals(await oracle.getTotalRequestsProcessed(), requestCount)
      })

      it('should not change on empty report', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const report = await prepareReportAndSubmitHash([])
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        assert.equals(await oracle.getTotalRequestsProcessed(), requestCount)
      })
    })

    context('getProcessingState reflects state change', () => {
      after(rollback)

      let report
      let hash

      it('has correct defaults on init', async () => {
        const state = await oracle.getProcessingState()
        assertEqualsObject(state, {
          currentFrameRefSlot: (await consensus.getCurrentFrame()).refSlot,
          processingDeadlineTime: 0,
          dataHash: ZERO_HASH,
          dataSubmitted: false,
          dataFormat: 0,
          requestsCount: 0,
          requestsSubmitted: 0,
        })
      })

      it('consensus report submitted', async () => {
        report = await prepareReportAndSubmitHash([
          { moduleId: 5, nodeOpId: 1, valIndex: 10, valPubkey: PUBKEYS[2] },
          { moduleId: 5, nodeOpId: 3, valIndex: 1, valPubkey: PUBKEYS[3] },
        ])
        hash = calcValidatorsExitBusReportDataHash(report)
        const state = await oracle.getProcessingState()
        assertEqualsObject(state, {
          currentFrameRefSlot: (await consensus.getCurrentFrame()).refSlot,
          processingDeadlineTime: computeTimestampAtSlot(
            (await consensus.getCurrentFrame()).reportProcessingDeadlineSlot
          ),
          dataHash: hash,
          dataSubmitted: false,
          dataFormat: 0,
          requestsCount: 0,
          requestsSubmitted: 0,
        })
      })

      it('report is processed', async () => {
        await oracle.submitReportData(report, oracleVersion, { from: member1 })
        const state = await oracle.getProcessingState()
        assertEqualsObject(state, {
          currentFrameRefSlot: (await consensus.getCurrentFrame()).refSlot,
          processingDeadlineTime: computeTimestampAtSlot(
            (await consensus.getCurrentFrame()).reportProcessingDeadlineSlot
          ),
          dataHash: hash,
          dataSubmitted: true,
          dataFormat: DATA_FORMAT_LIST,
          requestsCount: 2,
          requestsSubmitted: 2,
        })
      })

      it('at next frame state resets', async () => {
        await consensus.advanceTimeToNextFrameStart()
        const state = await oracle.getProcessingState()
        assertEqualsObject(state, {
          currentFrameRefSlot: (await consensus.getCurrentFrame()).refSlot,
          processingDeadlineTime: 0,
          dataHash: ZERO_HASH,
          dataSubmitted: false,
          dataFormat: 0,
          requestsCount: 0,
          requestsSubmitted: 0,
        })
      })
    })
  })
})
