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
        case 'StakingProviderAdded':
          const stakingProvidersCount = await getStakingProvidersCount()
          return {
            ...nextState,
            stakingProvidersCount,
            activeStakingProvidersCount: await getActiveStakingProvidersCount(),
            stakingProviders: await getStakingProviders(stakingProvidersCount),
          }
        case 'StakingProviderActiveSet':
          return {
            ...nextState,
            activeStakingProvidersCount: await getActiveStakingProvidersCount(),
            stakingProviders: await getStakingProviders(
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
    const stakingProvidersCount = await getStakingProvidersCount()
    return {
      ...cachedState,
      stakingProvidersCount,
      activeStakingProvidersCount: await getActiveStakingProvidersCount(),
      stakingProviders: await getStakingProviders(stakingProvidersCount),
    }
  }
}

async function getStakingProvidersCount() {
  return await app.call('getStakingProvidersCount').toPromise()
}

async function getActiveStakingProvidersCount() {
  return await app.call('getActiveStakingProvidersCount').toPromise()
}

function getStakingProviderInfo(index) {
  return app.call('getStakingProvider', index, true).toPromise()
}

async function getStakingProviders(numberOfProviders) {
  const stakingProviders = []

  for (let id = 0; id < numberOfProviders; id++) {
    const info = await getStakingProviderInfo(id)
    stakingProviders.push({
      ...info,
      id,
    })
  }

  return stakingProviders
}
