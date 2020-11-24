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
          const nodeOperatorsCount = await getNodeOperatorsCount()
          return {
            ...nextState,
            nodeOperatorsCount,
            activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
            nodeOperators: await getNodeOperators(nodeOperatorsCount),
          }
        case 'NodeOperatorActiveSet':
          return {
            ...nextState,
            activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
            nodeOperators: await getNodeOperators(nextState.nodeOperatorsCount),
          }
        case 'SigningKeyAdded':
          return {
            ...nextState,
            nodeOperators: await getNodeOperators(nextState.nodeOperatorsCount),
          }
        case 'NodeOperatorStakingLimitSet':
          return {
            ...nextState,
            nodeOperators: await getNodeOperators(nextState.nodeOperatorsCount),
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
    const nodeOperatorsCount = await getNodeOperatorsCount()
    return {
      ...cachedState,
      nodeOperatorsCount,
      activeNodeOperatorsCount: await getActiveNodeOperatorsCount(),
      nodeOperators: await getNodeOperators(nodeOperatorsCount),
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

async function getNodeOperators(numberOfOperators) {
  const nodeOperators = []

  for (let id = 0; id < numberOfOperators; id++) {
    const info = await getNodeOperatorInfo(id)
    nodeOperators.push({
      ...info,
      id,
    })
  }

  return nodeOperators
}
