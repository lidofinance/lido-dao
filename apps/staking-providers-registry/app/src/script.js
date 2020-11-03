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
        case 'NodeOperatorAdded':
          // eslint-disable-next-line no-case-declarations
          const stakingProvidersCount = await getNodeOperatorsCount()
          return {
            ...nextState,
            stakingProvidersCount,
            activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
            stakingProviders: await getNodeOperators(stakingProvidersCount),
          }
        case 'NodeOperatorActiveSet':
          return {
            ...nextState,
            activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
            stakingProviders: await getNodeOperators(
              nextState.stakingProvidersCount
            ),
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
 *   Event Handlers    *
 ***********************/

function initializeState() {
  return async (cachedState) => {
    const stakingProvidersCount = await getNodeOperatorsCount()
    return {
      ...cachedState,
      stakingProvidersCount,
      activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
      stakingProviders: await getNodeOperators(stakingProvidersCount),
    }
  }
}

async function getNodeOperatorsCount() {
  return await app.call('getNodeOperatorsCount').toPromise()
}

async function getActiveNodeOperatorsCount() {
  return await app.call('getActiveNodeOperatorsCount').toPromise()
}

function getNodeOperatorInfo(index) {
  return app.call('getNodeOperator', index, true).toPromise()
}

async function getNodeOperators(numberOfProviders) {
  const stakingProviders = []

  for (let id = 0; id < numberOfProviders; id++) {
    const info = await getNodeOperatorInfo(id)
    stakingProviders.push({
      ...info,
      id,
    })
  }

  return stakingProviders
}
