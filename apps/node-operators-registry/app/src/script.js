import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import LocatorABI from "./abi/LidoLocator.abi.json"
import StakingRouteABI from "./abi/StakingRouter.abi.json"

const app = new Aragon()

const createFetcher =
  (functionName, ...args) =>
    () =>
      app.call(functionName, ...args).toPromise()

const offset = 0
const MAX_OPERATORS = 200
const getNodeOperatorsIds = createFetcher(
  'getNodeOperatorIds',
  offset,
  MAX_OPERATORS
)

const getNodeOperator = (nodeOperatorId) =>
  createFetcher('getNodeOperator', nodeOperatorId, true)()

const getNodeOperators = async () => {
  const nodeOperatorsIds = await getNodeOperatorsIds()
  const promises = nodeOperatorsIds.map((id) => getNodeOperator(id))
  const settledPromises = await Promise.allSettled(promises)
  const nodeOperators = settledPromises.map((settled) => settled.value)
  return nodeOperators.map((no, i) => ({ ...no, id: nodeOperatorsIds[i] }))
}

const protocolVariables = [
  {
    stateKey: 'stakingModuleSummary',
    updateEvents: [
      'VettedSigningKeysCountChanged',
      'DepositedSigningKeysCountChanged',
      'ExitedSigningKeysCountChanged',
      'TotalSigningKeysCountChanged',
      'StuckValidatorsCountChanged',
      'RefundedValidatorsCountChanged',
    ],
    fetch: createFetcher('getStakingModuleSummary'),
  },
  {
    stateKey: 'nonce',
    updateEvents: ['KeysOpIndexSet', 'NonceChanged'],
    fetch: createFetcher('getNonce'),
  },
  {
    stateKey: 'nodeOperatorsCount',
    updateEvents: [],
    fetch: createFetcher('getNodeOperatorsCount'),
  },
  {
    stateKey: 'activeNodeOperatorsCount',
    updateEvents: [],
    fetch: createFetcher('getActiveNodeOperatorsCount'),
  },
  {
    stateKey: 'stuckPenaltyDelay',
    updateEvents: [],
    fetch: createFetcher('getStuckPenaltyDelay'),
  },
  {
    stateKey: 'nodeOperators',
    updateEvents: [
      'NodeOperatorAdded',
      'NodeOperatorActiveSet',
      'NodeOperatorNameSet',
      'NodeOperatorRewardAddressSet',
      'NodeOperatorTotalKeysTrimmed',
      '',
    ],
    fetch: getNodeOperators,
  },
  {
    stateKey: 'stakingModuleType',
    updateEvents: ['StakingModuleTypeSet'],
    fetch: createFetcher('getType'),
  },
  {
    stateKey: 'hasInitialized',
    updateEvents: [],
    fetch: createFetcher('hasInitialized'),
  },
  {
    stateKey: 'initializationBlock',
    updateEvents: [],
    fetch: createFetcher('getInitializationBlock'),
  },
  {
    stateKey: 'contractVersion',
    updateEvents: ['ContractVersionSet'],
    fetch: createFetcher('getContractVersion'),
  },
  {
    stateKey: 'locator',
    updateEvents: [],
    fetch: createFetcher('getLocator'),
  },
]

const StakingRouterState = [
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "feePrecisionPoints",
    contractFunction: "FEE_PRECISION_POINTS"
  },
  {
    appStateKey: "maxStakingModulesCount",
    contractFunction: "MAX_STAKING_MODULES_COUNT"
  },
  {
    appStateKey: "totalBasisPoints",
    contractFunction: "TOTAL_BASIS_POINTS"
  },
  {
    appStateKey: "allStakingModuleDigests",
    contractFunction: "getAllStakingModuleDigests"
  },
  {
    appStateKey: "contractVersion",
    contractFunction: "getContractVersion"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "lido",
    contractFunction: "getLido"
  },
  {
    appStateKey: "stakingFeeAggregateDistribution",
    contractFunction: "getStakingFeeAggregateDistribution"
  },
  {
    appStateKey: "stakingModuleIds",
    contractFunction: "getStakingModuleIds"
  },
  {
    appStateKey: "stakingRewardsDistribution",
    contractFunction: "getStakingRewardsDistribution"
  },
  {
    appStateKey: "totalFeeE4Precision",
    contractFunction: "getTotalFeeE4Precision"
  },
  {
    appStateKey: "withdrawalCredentials",
    contractFunction: "getWithdrawalCredentials"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
  {
    appStateKey: "depositContract",
    contractFunction: "DEPOSIT_CONTRACT"
  },
]

app.store(
  async (state, { event }) => {
    const nextState = {
      ...state,
    }

    try {
      if (event === events.SYNC_STATUS_SYNCING) {
        return { ...nextState, isSyncing: true }
      }

      if (event === events.SYNC_STATUS_SYNCED) {
        return { ...nextState, isSyncing: false }
      }

      const variable = protocolVariables.find(({ updateEvents }) =>
        updateEvents.includes(event)
      )

      if (variable) {
        return {
          ...nextState,
          [variable.stateKey]: await variable.fetch(),
        }
      }

      return nextState
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
    const promises = protocolVariables.map((v) => v.fetch())

    const settledPromises = await Promise.allSettled(promises)

    const updatedState = settledPromises.reduce((stateObject, cur, index) => {
      stateObject[protocolVariables[index].stateKey] = cur.value
      return stateObject
    }, {})

    const { locator } = updatedState

    const locatorContract = app.external(locator, LocatorABI)

    const stakingRouter = await locatorContract.stakingRouter().toPromise()

    const stakingRouterContract = app.external(stakingRouter, StakingRouteABI)
    const srPromises = StakingRouterState.map(({ contractFunction }) => stakingRouterContract[contractFunction]().toPromise())
    const settledSrPromises = await Promise.allSettled(srPromises)
    const srState = settledSrPromises.reduce((stateObject, cur, index) => {
      stateObject[StakingRouterState[index].appStateKey] = cur.value
      return stateObject
    }, {})

    srState.globalDigest = srState.allStakingModuleDigests.reduce((obj, cur) => {
      obj.stakingModulesCount += 1
      obj.nodeOperatorsCount += +cur.nodeOperatorsCount
      obj.activeNodeOperatorsCount += +cur.activeNodeOperatorsCount
      obj.depositableValidatorsCount += +cur.summary.depositableValidatorsCount
      obj.exitedValidatorsCount += +cur.state.exitedValidatorsCount
      obj.totalDepositedValidators += +cur.summary.totalDepositedValidators

      return obj
    }, {
      stakingModulesCount: 0,
      nodeOperatorsCount: 0,
      activeNodeOperatorsCount: 0,
      depositableValidatorsCount: 0,
      exitedValidatorsCount: 0,
      totalDepositedValidators: 0,
    })


    return {
      ...cachedState,
      curated: updatedState,
      stakingRouter: srState,
    }
  }
}
