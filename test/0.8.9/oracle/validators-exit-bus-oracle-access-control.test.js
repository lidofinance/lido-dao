const { contract, web3 } = require('hardhat')
const { assert } = require('../../helpers/assert')
const { ZERO_ADDRESS } = require('../../helpers/constants')

const {
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
]

contract('ValidatorsExitBusOracle', ([admin, member1, member2, member3, account1, stranger]) => {
  let consensus
  let oracle
  let oracleVersion
  let initTx
  let exitRequests
  let reportFields
  let reportItems
  let reportHash

  const submitDataRoleKeccak156 = web3.utils.keccak256('SUBMIT_DATA_ROLE')
  const pauseRoleKeccak156 = web3.utils.keccak256('PAUSE_ROLE')
  const resumeRoleKeccak156 = web3.utils.keccak256('RESUME_ROLE')

  const getReportFields = (override = {}) => ({
    consensusVersion: CONSENSUS_VERSION,
    dataFormat: DATA_FORMAT_LIST,
    ...override,
  })
  const deploy = async () => {
    const deployed = await deployExitBusOracle(admin, { resumeAfterDeploy: true })
    consensus = deployed.consensus
    oracle = deployed.oracle
    initTx = deployed.initTx

    oracleVersion = +(await oracle.getContractVersion())

    await consensus.addMember(member1, 1, { from: admin })
    await consensus.addMember(member2, 2, { from: admin })
    await consensus.addMember(member3, 2, { from: admin })

    const { refSlot } = await deployed.consensus.getCurrentFrame()
    exitRequests = [
      { moduleId: 1, nodeOpId: 0, valIndex: 0, valPubkey: PUBKEYS[0] },
      { moduleId: 1, nodeOpId: 0, valIndex: 2, valPubkey: PUBKEYS[1] },
      { moduleId: 2, nodeOpId: 0, valIndex: 1, valPubkey: PUBKEYS[2] },
    ]

    reportFields = getReportFields({
      refSlot: +refSlot,
      requestsCount: exitRequests.length,
      data: encodeExitRequestsDataList(exitRequests),
    })

    reportItems = getValidatorsExitBusReportDataItems(reportFields)
    reportHash = calcValidatorsExitBusReportDataHash(reportItems)

    await deployed.consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member1 })
    await deployed.consensus.submitReport(refSlot, reportHash, CONSENSUS_VERSION, { from: member3 })
  }

  context('Access control', () => {
    context('deploying', () => {
      before(deploy)

      it('deploying accounting oracle', async () => {
        assert.isDefined(oracle)
        assert.isDefined(consensus)
        assert.isDefined(oracleVersion)
        assert.isDefined(initTx)
        assert.isDefined(exitRequests)
        assert.isDefined(reportFields)
        assert.isDefined(reportItems)
        assert.isDefined(reportHash)
      })
    })
    context('DEFAULT_ADMIN_ROLE', () => {
      beforeEach(deploy)

      context('Admin is set at initialize', () => {
        it('should set admin at initialize', async () => {
          const DEFAULT_ADMIN_ROLE = await oracle.DEFAULT_ADMIN_ROLE()
          assert.emits(initTx, 'RoleGranted', { role: DEFAULT_ADMIN_ROLE, account: admin, sender: admin })
        })

        it('should revert without admin address', async () => {
          await assert.reverts(
            oracle.initialize(ZERO_ADDRESS, consensus.address, CONSENSUS_VERSION, 0, {
              from: admin,
            }),
            'AdminCannotBeZero()'
          )
        })
      })
    })

    context('SUBMIT_DATA_ROLE', () => {
      beforeEach(deploy)

      context('_checkMsgSenderIsAllowedToSubmitData', () => {
        it('should revert from not consensus member without SUBMIT_DATA_ROLE role', async () => {
          await assert.reverts(
            oracle.submitReportData(reportItems, oracleVersion, { from: stranger }),
            'SenderNotAllowed()'
          )
        })

        it('should allow calling from a possessor of SUBMIT_DATA_ROLE role', async () => {
          await oracle.grantRole(submitDataRoleKeccak156, account1)
          const deadline = (await oracle.getConsensusReport()).processingDeadlineTime
          await consensus.setTime(deadline)

          const tx = await oracle.submitReportData(reportItems, oracleVersion, { from: account1 })
          assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
        })
        it('should allow calling from a member', async () => {
          const tx = await oracle.submitReportData(reportItems, CONSENSUS_VERSION, { from: member2 })
          assert.emits(tx, 'ProcessingStarted', { refSlot: reportFields.refSlot })
        })
      })
    })

    context('PAUSE_ROLE', () => {
      beforeEach(deploy)

      context('pause', () => {
        it('should revert without PAUSE_ROLE role', async () => {
          await assert.revertsOZAccessControl(oracle.pauseFor(0, { from: stranger }), stranger, 'PAUSE_ROLE')
        })

        it('should allow calling from a possessor of PAUSE_ROLE role', async () => {
          await oracle.grantRole(pauseRoleKeccak156, account1)

          const tx = await oracle.pauseFor(9999, { from: account1 })
          assert.emits(tx, 'Paused', { duration: 9999 })
        })
      })
    })

    context('RESUME_ROLE', () => {
      beforeEach(deploy)

      context('resume', () => {
        it('should revert without RESUME_ROLE role', async () => {
          await oracle.pauseFor(9999, { from: admin })

          await assert.revertsOZAccessControl(oracle.resume({ from: stranger }), stranger, 'RESUME_ROLE')
        })

        it('should allow calling from a possessor of RESUME_ROLE role', async () => {
          await oracle.pauseFor(9999, { from: admin })
          await oracle.grantRole(resumeRoleKeccak156, account1)

          const tx = await oracle.resume({ from: account1 })
          assert.emits(tx, 'Resumed')
        })
      })
    })
  })
})
