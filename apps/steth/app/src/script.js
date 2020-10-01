import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'

const app = new Aragon()

app.store(
  async (state, { event }) => {
    const nextState = {
      ...state,
    }

    console.log({ state, event })

    try {
      switch (event) {
        case 'Stopped':
          return { ...nextState, isStopped: await getIsStopped() }
        case 'Resumed':
          return { ...nextState, isStopped: await getIsStopped() }
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
      isStopped: await getIsStopped(),
      // tokenName: await getTokenName(),
    }
  }
}

async function getIsStopped() {
  return await app.isStopped().toPromise()
}

async function getTokenName() {
  return await app.name().toPromise()
}
