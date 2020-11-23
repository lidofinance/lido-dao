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
        case 'Stopped':
          return { ...nextState, isStopped: await getIsStopped() }
        case 'Resumed':
          return { ...nextState, isStopped: await getIsStopped() }
        case 'Transfer':
          return { ...nextState, totalSupply: await getTotalSupply() }
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
      tokenName: await getTokenName(),
      tokenSymbol: await getTokenSymbol(),
      totalSupply: await getTotalSupply(),
    }
  }
}

function getIsStopped() {
  return app.call('isStopped').toPromise()
}

function getTokenName() {
  return app.call('name').toPromise()
}

function getTokenSymbol() {
  return app.call('symbol').toPromise()
}

function getTotalSupply() {
  return app.call('totalSupply').toPromise()
}
