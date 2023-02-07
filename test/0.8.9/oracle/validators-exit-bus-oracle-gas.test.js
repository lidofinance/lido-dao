const { BN } = require('bn.js')
const { assert } = require('chai')
const { assertBn, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { assertRevert } = require('../../helpers/assertThrow')
const { toNum, processNamedTuple } = require('../../helpers/utils')
const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')

const {
  SLOTS_PER_EPOCH, SECONDS_PER_SLOT, GENESIS_TIME, SECONDS_PER_EPOCH,
  EPOCHS_PER_FRAME, SLOTS_PER_FRAME, SECONDS_PER_FRAME,
  MAX_REQUESTS_PER_REPORT, MAX_REQUESTS_LIST_LENGTH,
  MAX_REQUESTS_PER_DAY, RATE_LIMIT_WINDOW_SLOTS, RATE_LIMIT_THROUGHPUT,
  computeSlotAt, computeEpochAt, computeEpochFirstSlotAt,
  computeEpochFirstSlot, computeTimestampAtSlot, computeTimestampAtEpoch,
  ZERO_HASH, CONSENSUS_VERSION, DATA_FORMAT_LIST, getReportDataItems, calcReportDataHash,
  encodeExitRequestHex, encodeExitRequestsDataList, deployExitBusOracle,
  deployOracleReportSanityCheckerForExitBus,
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
      const deployed = await deployExitBusOracle(admin)
      consensus = deployed.consensus
      oracle = deployed.oracle

      await oracle.resume({from: admin})

      oracleVersion = +await oracle.getContractVersion()

      await consensus.addMember(member1, 1, {from: admin})
      await consensus.addMember(member2, 2, {from: admin})
      await consensus.addMember(member3, 2, {from: admin})
    })

    async function triggerConsensusOnHash(hash) {
      const {refSlot} = await consensus.getCurrentFrame()
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member1 })
      await consensus.submitReport(refSlot, hash, CONSENSUS_VERSION, { from: member3 })
      assert.equal((await consensus.getConsensusState()).consensusReport, hash)
    }

    function generateExitRequests(totalRequests) {
      const requestsByModule = Math.max(3, Math.floor(totalRequests / 3))
      const requestsByNodeOp = Math.max(1, Math.floor(requestsByModule / 3))

      const requests = []

      for (let i = 0; i < totalRequests; ++i) {
        const moduleId = Math.floor(i / requestsByModule)
        const nodeOpId = Math.floor((i - moduleId * requestsByModule) / requestsByNodeOp)
        const valIndex = i - moduleId * requestsByModule - nodeOpId * requestsByNodeOp
        const valPubkey = PUBKEYS[valIndex % PUBKEYS.length]
        requests.push({moduleId: moduleId + 1, nodeOpId, valIndex, valPubkey })
      }

      return requests
    }

    // pre-heating
    testGas(10, () => {})

    const gasUsages = [];
    [10, 50, 100, 1000, 2000].forEach(n => testGas(n, r => gasUsages.push(r)))

    after(async () => {
      gasUsages.forEach(({totalRequests, gasUsed}) => console.log(
        `${totalRequests} requests: total gas ${ gasUsed }, ` +
        `gas per request: ${ Math.round(gasUsed / totalRequests )}`
      ))
    })

    function testGas(totalRequests, reportGas) {
      let exitRequests
      let reportFields
      let reportItems
      let reportHash

      describe(`Total requests: ${totalRequests}`, () => {

        it('initially, consensus report is not being processed', async () => {
          const {refSlot} = await consensus.getCurrentFrame()

          const report = await oracle.getConsensusReport()
          assert.isAbove(+refSlot, +report.refSlot)

          const procState = await oracle.getDataProcessingState()
          assert.equal(+procState.refSlot, +report.refSlot)
        })

        it('committee reaches consensus on a report hash', async () => {
          const {refSlot} = await consensus.getCurrentFrame()

          exitRequests = generateExitRequests(totalRequests)

          reportFields = {
            consensusVersion: CONSENSUS_VERSION,
            refSlot: +refSlot,
            requestsCount: exitRequests.length,
            dataFormat: DATA_FORMAT_LIST,
            data: encodeExitRequestsDataList(exitRequests),
          }

          reportItems = getReportDataItems(reportFields)
          reportHash = calcReportDataHash(reportItems)

          await triggerConsensusOnHash(reportHash)
        })

        it('oracle gets the report hash', async () => {
          const report = await oracle.getConsensusReport()
          assert.equal(report.hash, reportHash)
          assert.equal(+report.refSlot, +reportFields.refSlot)
          assert.equal(+report.receptionTime, +await oracle.getTime())
          assert.equal(+report.deadlineTime, computeTimestampAtSlot(+report.refSlot + SLOTS_PER_FRAME))
          assert.isFalse(report.processingStarted)

          const procState = await oracle.getDataProcessingState()
          assert.isFalse(procState.processingStarted)
          assert.equal(+procState.requestsCount, 0)
          assert.equal(+procState.requestsProcessed, 0)
          assert.equal(+procState.dataFormat, 0)
        })

        it('some time passes', async () => {
          await consensus.advanceTimeBy(Math.floor(SECONDS_PER_FRAME / 3))
        })

        it(`a committee member submits the report data, exit requests are emitted`, async () => {
          const tx = await oracle.submitReportData(reportItems, oracleVersion, {from: member1})
          assertEvent(tx, 'ProcessingStarted', {expectedArgs: {refSlot: reportFields.refSlot}})
          assert.isTrue((await oracle.getConsensusReport()).processingStarted)

          const {timestamp} = await web3.eth.getBlock(tx.receipt.blockHash)

          for (let i = 0; i < exitRequests.length; ++i) {
            assertEvent(tx, 'ValidatorExitRequest', {index: i, expectedArgs: {
              stakingModuleId: exitRequests[i].moduleId,
              nodeOperatorId: exitRequests[i].nodeOpId,
              validatorIndex: exitRequests[i].valIndex,
              validatorPubkey: exitRequests[i].valPubkey,
              timestamp
            }})
          }

          const {gasUsed} = tx.receipt
          reportGas({totalRequests, gasUsed})
        })

        it(`reports are marked as processed`, async () => {
          const procState = await oracle.getDataProcessingState()
          assert.isTrue(procState.processingStarted)
          assert.equal(+procState.requestsCount, exitRequests.length)
          assert.equal(+procState.requestsProcessed, exitRequests.length)
          assert.equal(+procState.dataFormat, DATA_FORMAT_LIST)
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
