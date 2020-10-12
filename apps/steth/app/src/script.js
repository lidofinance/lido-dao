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
      tokenName: await getTokenName(),
      tokenSymbol: await getTokenSymbol(),
      totalSupply: await getTotalSupply(),
    }
  }
}

async function getIsStopped() {
  return await app.call('isStopped').toPromise()
}

async function getTokenName() {
  return await app.call('name').toPromise()
}

async function getTokenSymbol() {
  return await app.call('symbol').toPromise()
}

async function getTotalSupply() {
  return fromWei(await app.call('totalSupply').toPromise())
}
