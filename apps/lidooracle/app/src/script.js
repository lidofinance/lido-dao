import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'

const app = new Aragon()

app.store(
  async (state, { event }) => {
    const nextState = {
      ...state,
    }

    try {
      switch (event) {
        case 'MemberAdded':
          return { ...nextState, oracleMembers: await getOracleMembers() }
        case 'MemberRemoved':
          return { ...nextState, oracleMembers: await getOracleMembers() }
        case 'QuorumChanged':
          return { ...nextState, quorum: await getQuorum() }
        case 'ExpectedEpochIdUpdated':
          return { ...nextState, expectedEpochId: await getExpectedEpochId() }
        case 'AllowedBeaconBalanceAnnualRelativeIncreaseSet':
          return {
            ...nextState,
            allowedBeaconBalanceAnnualRelativeIncrease: await getAllowedBeaconBalanceAnnualRelativeIncrease(),
          }
        case 'AllowedBeaconBalanceRelativeDecreaseSet':
          return {
            ...nextState,
            allowedBeaconBalanceRelativeDecrease: await getAllowedBeaconBalanceRelativeDecrease(),
          }
        case 'UI:UpdateFrame':
          return { ...nextState, currentFrame: await getCurrentFrame() }
        case 'BeaconReportReceiverSet':
          return {
            ...nextState,
            beaconReportReceiver: await getBeaconReportReceiver(),
          }
        case 'BeaconReported':
          return {
            ...nextState,
            currentReportVariants: await getCurrentReportVariants(),
            currentOraclesReportStatus: await getCurrentOraclesReportStatus(),
          }
        case 'ContractVersionSet':
          return {
            ...nextState,
            version: await getVersion(),
          }
        case events.SYNC_STATUS_SYNCING:
          return { ...nextState, isSyncing: true }
        case events.SYNC_STATUS_SYNCED:
          return { ...nextState, isSyncing: false }
        default:
          return state
      }
    } catch (err) {
      console.log(err)
    }
  },
  {
    init: initializeState(),
  }
)

/***********************
 *                     *
 *   Event Handlers    *
 *                     *
 ***********************/

function initializeState() {
  return async (cachedState) => {
    const [
      oracleMembers,
      quorum,
      currentFrame,
      expectedEpochId,
      currentOraclesReportStatus,
      allowedBeaconBalanceAnnualRelativeIncrease,
      allowedBeaconBalanceRelativeDecrease,
      beaconReportReceiver,
      currentReportVariants,
      lastCompletedReportDelta,
      version,
    ] = await Promise.all([
      getOracleMembers(),
      getQuorum(),
      getCurrentFrame(),
      getExpectedEpochId(),
      getCurrentOraclesReportStatus(),
      getAllowedBeaconBalanceAnnualRelativeIncrease(),
      getAllowedBeaconBalanceRelativeDecrease(),
      getBeaconReportReceiver(),
      getCurrentReportVariants(),
      getLastCompletedReportDelta(),
      getVersion(),
    ])

    return {
      ...cachedState,
      oracleMembers,
      quorum,
      currentFrame,
      expectedEpochId,
      currentOraclesReportStatus,
      allowedBeaconBalanceAnnualRelativeIncrease,
      allowedBeaconBalanceRelativeDecrease,
      beaconReportReceiver,
      currentReportVariants,
      lastCompletedReportDelta,
      version,
    }
  }
}

function getOracleMembers() {
  return app.call('getOracleMembers').toPromise()
}

function getQuorum() {
  return app.call('getQuorum').toPromise()
}

async function getCurrentFrame() {
  const frame = await app.call('getCurrentFrame').toPromise()
  return {
    frameEpochId: String(frame.frameEpochId),
    frameStartTime: +frame.frameStartTime,
    frameEndTime: +frame.frameEndTime,
  }
}

function getExpectedEpochId() {
  return app.call('getExpectedEpochId').toPromise()
}

function getCurrentOraclesReportStatus() {
  return app.call('getCurrentOraclesReportStatus').toPromise()
}

function getCurrentReportVariantsSize() {
  return app.call('getCurrentReportVariantsSize').toPromise()
}

async function getCurrentReportVariant(index) {
  return app.call('getCurrentReportVariant', index).toPromise()
}

async function getCurrentReportVariants() {
  const size = await getCurrentReportVariantsSize()

  const variants = []
  for (let i = 0; i < size; i++) {
    const variant = await getCurrentReportVariant(i)
    variants.push(variant)
  }

  return variants
}

function getLastCompletedReportDelta() {
  return app.call('getLastCompletedReportDelta').toPromise()
}

function getAllowedBeaconBalanceAnnualRelativeIncrease() {
  return app.call('getAllowedBeaconBalanceAnnualRelativeIncrease').toPromise()
}

function getAllowedBeaconBalanceRelativeDecrease() {
  return app.call('getAllowedBeaconBalanceRelativeDecrease').toPromise()
}

function getBeaconReportReceiver() {
  return app.call('getBeaconReportReceiver').toPromise()
}

async function getVersion() {
  return app.call('getVersion').toPromise()
}
