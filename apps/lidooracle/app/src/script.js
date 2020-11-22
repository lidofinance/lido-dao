import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import { fromWei } from 'web3-utils'

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
        case 'Completed':
        case 'UI:UpdateReportableEpochs':
          return {
            ...nextState,
            currentReportableEpochs: await getCurrentReportableEpochs(),
          }
        case 'UI:UpdateFrame':
          return { ...nextState, currentFrame: await getCurrentFrame() }
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
      currentReportableEpochs,
    ] = await Promise.all([
      getOracleMembers(),
      getQuorum(),
      getCurrentFrame(),
      getCurrentReportableEpochs(),
    ])
    return {
      ...cachedState,
      oracleMembers,
      quorum,
      currentFrame,
      currentReportableEpochs,
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

async function getCurrentReportableEpochs() {
  const epochs = await app.call('getCurrentReportableEpochs').toPromise()
  return {
    firstReportableEpochId: String(epochs.firstReportableEpochId),
    lastReportableEpochId: String(epochs.lastReportableEpochId),
  }
}
