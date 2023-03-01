const { contract } = require('hardhat')
const { assert } = require('../../helpers/assert')

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
  context('Gas test', () => {
    let consensus
    let oracle
    let oracleVersion

    before(async () => {
      const deployed = await deployExitBusOracle(admin, { resumeAfterDeploy: true })
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

    const NUM_MODULES = 5
    const NODE_OPS_PER_MODULE = 100

    let nextValIndex = 1

    function generateExitRequests(totalRequests) {
      const requestsPerModule = Math.max(1, Math.floor(totalRequests / NUM_MODULES))
      const requestsPerNodeOp = Math.max(1, Math.floor(requestsPerModule / NODE_OPS_PER_MODULE))

      const requests = []

      for (let i = 0; i < totalRequests; ++i) {
        const moduleId = Math.floor(i / requestsPerModule)
        const nodeOpId = Math.floor((i - moduleId * requestsPerModule) / requestsPerNodeOp)
        const valIndex = nextValIndex++
        const valPubkey = PUBKEYS[valIndex % PUBKEYS.length]
        requests.push({ moduleId: moduleId + 1, nodeOpId, valIndex, valPubkey })
      }

      return { requests, requestsPerModule, requestsPerNodeOp }
    }

    // pre-heating
    testGas(NUM_MODULES * NODE_OPS_PER_MODULE, () => {})

    const gasUsages = []
    ;[10, 50, 100, 1000, 2000].forEach((n) => testGas(n, (r) => gasUsages.push(r)))

    after(async () => {
      gasUsages.forEach(({ totalRequests, requestsPerModule, requestsPerNodeOp, gasUsed }) =>
        console.log(
          `${totalRequests} requests (per module ${requestsPerModule}, ` +
            `per node op ${requestsPerNodeOp}): total gas ${gasUsed}, ` +
            `gas per request: ${Math.round(gasUsed / totalRequests)}`
        )
      )
    })

    function testGas(totalRequests, reportGas) {
      let exitRequests
      let reportFields
      let reportItems
      let reportHash

      describe(`Total requests: ${totalRequests}`, () => {
        it('initially, consensus report is not being processed', async () => {
          const { refSlot } = await consensus.getCurrentFrame()

          const report = await oracle.getConsensusReport()
          assert.isAbove(+refSlot, +report.refSlot)

          const procState = await oracle.getProcessingState()
          assert.equal(procState.dataHash, ZERO_HASH)
          assert.isFalse(procState.dataSubmitted)
        })

        it('committee reaches consensus on a report hash', async () => {
          const { refSlot } = await consensus.getCurrentFrame()

          exitRequests = generateExitRequests(totalRequests)

          reportFields = {
            consensusVersion: CONSENSUS_VERSION,
            refSlot: +refSlot,
            requestsCount: exitRequests.requests.length,
            dataFormat: DATA_FORMAT_LIST,
            data: encodeExitRequestsDataList(exitRequests.requests),
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

          const procState = await oracle.getProcessingState()
          assert.equal(procState.dataHash, reportHash)
          assert.isFalse(procState.dataSubmitted)
          assert.equals(procState.dataFormat, 0)
          assert.equals(procState.requestsCount, 0)
          assert.equals(procState.requestsSubmitted, 0)
        })

        it('some time passes', async () => {
          await consensus.advanceTimeBy(Math.floor(SECONDS_PER_FRAME / 3))
        })

        it(`a committee member submits the report data, exit requests are emitted`, async () => {
          const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: member1 })
          assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
          assert.isTrue((await oracle.getConsensusReport()).processingStarted)

          const timestamp = await oracle.getTime()
          const { requests, requestsPerModule, requestsPerNodeOp } = exitRequests

          for (let i = 0; i < requests.length; ++i) {
            assert.emitsAt(tx, 'ValidatorExitRequest', i, {
              stakingModuleId: requests[i].moduleId,
              nodeOperatorId: requests[i].nodeOpId,
              validatorIndex: requests[i].valIndex,
              validatorPubkey: requests[i].valPubkey,
              timestamp,
            })
          }

          const { gasUsed } = tx.receipt
          reportGas({ totalRequests, requestsPerModule, requestsPerNodeOp, gasUsed })
        })

        it(`reports are marked as processed`, async () => {
          const procState = await oracle.getProcessingState()
          assert.equal(procState.dataHash, reportHash)
          assert.isTrue(procState.dataSubmitted)
          assert.equals(procState.dataFormat, DATA_FORMAT_LIST)
          assert.equals(procState.requestsCount, exitRequests.requests.length)
          assert.equals(procState.requestsSubmitted, exitRequests.requests.length)
        })

        it('some time passes', async () => {
          const prevFrame = await consensus.getCurrentFrame()
          await consensus.advanceTimeBy(SECONDS_PER_FRAME - Math.floor(SECONDS_PER_FRAME / 3))
          const newFrame = await consensus.getCurrentFrame()
          assert.isAbove(+newFrame.refSlot, +prevFrame.refSlot)
        })
      })
    }
  })
})
