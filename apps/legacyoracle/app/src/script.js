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
        case 'ExpectedEpochIdUpdated':
          return { ...nextState, expectedEpochId: await getExpectedEpochId() }
        case 'UI:UpdateFrame':
          return { ...nextState, currentFrame: await getCurrentFrame() }
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
      currentFrame,
      lastCompletedReportDelta,
      version,
    ] = await Promise.all([
      getCurrentFrame(),
      getLastCompletedReportDelta(),
      getVersion(),
    ])

    return {
      ...cachedState,
      currentFrame,
      lastCompletedReportDelta,
      version,
    }
  }
}

async function getCurrentFrame() {
  const frame = await app.call('getCurrentFrame').toPromise()
  return {
    frameEpochId: String(frame.frameEpochId),
    frameStartTime: +frame.frameStartTime,
    frameEndTime: +frame.frameEndTime,
  }
}

function getLastCompletedReportDelta() {
  return app.call('getLastCompletedReportDelta').toPromise()
}

async function getVersion() {
  return app.call('getVersion').toPromise()
}
