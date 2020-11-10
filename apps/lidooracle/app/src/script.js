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
    return {
      ...cachedState,
      oracleMembers: await getOracleMembers(),
      quorum: await getQuorum(),
      reportIntervalDurationSeconds: await getReportIntervalDurationSeconds(),
      latestData: await getLatestData(),
    }
  }
}

function getOracleMembers() {
  return app.call('getOracleMembers').toPromise()
}

function getQuorum() {
  return app.call('getQuorum').toPromise()
}

function getReportIntervalDurationSeconds() {
  return app.call('getReportIntervalDurationSeconds').toPromise()
}

function getLatestData() {
  return app.call('getLatestData').toPromise()
}
