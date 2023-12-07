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
  ZERO_HASH,
} = require('./validators-exit-bus-oracle-deploy.test')

const PUBKEYS = [
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
]

contract('ValidatorsExitBusOracle', ([admin, member1, member2, member3, stranger]) => {
  context('TriggerableExits', () => {
    const LAST_PROCESSING_REF_SLOT = 1

    let consensus
    let oracle
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

    before(deployAndSetup)

    context('_handleConsensusReportData', () => {
      beforeEach(async () => {
        await consensus.advanceTimeToNextFrameStart()
      })

      afterEach(rollback)

      it('validator exits', async () => {
        const { refSlot } = await consensus.getCurrentFrame()

        const hashBefore = await oracle.getRefSlotReportHash(refSlot)
        assert.equals(hashBefore, ZERO_HASH)

        const stateBefore = await oracle.getProcessingState()
        assert.equals(stateBefore.dataHash, ZERO_HASH)

        const requests = [
          { moduleId: 4, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[2] },
          { moduleId: 4, nodeOpId: 3, valIndex: 3, valPubkey: PUBKEYS[3] },
          { moduleId: 5, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[4] },
        ]
        const report = await prepareReportAndSubmitHash(requests)
        const receipt = await oracle.submitReportData(report, oracleVersion, { from: member1 })

        assert.emitsNumberOfEvents(receipt, 'TriggerExit', 1)

        const reportHash = calcValidatorsExitBusReportDataHash(report)

        const hashAfter = await oracle.getRefSlotReportHash(refSlot)
        assert.equals(hashAfter, reportHash)

        const stateAfter = await oracle.getProcessingState()
        assert.equals(stateAfter.dataHash, reportHash)

        await assert.reverts(oracle.submitValidatorsExit(0, report, 0, 10), `EmptyRefSlotHash()`)

        const exitRequests = [{ moduleId: 2, nodeOpId: 3, valIndex: 2, valPubkey: PUBKEYS[4] }]
        const wrongReportFields = getDefaultReportFields({
          refSlot: +refSlot,
          requestsCount: exitRequests.length,
          data: encodeExitRequestsDataList(exitRequests),
        })
        const wrongReport = getValidatorsExitBusReportDataItems(wrongReportFields)

        await assert.reverts(oracle.submitValidatorsExit(refSlot, wrongReport, 0, 10), `InvalidReportData()`)

        // good refslot and report
        await oracle.submitValidatorsExit(refSlot, report, 0, 10)
      })
    })
  })
})
