import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import LocatorABI from "./LidoLocator.abi.json"

const app = new Aragon()

const createFetcher = (functionName) => () => app.call(functionName).toPromise()

const protocolVariables = [
  {
    stateKey: 'isStopped',
    updateEvents: ['Resumed', 'Stopped'],
    fetch: createFetcher('isStopped'),
  },
  {
    stateKey: 'canDeposit',
    updateEvents: [],
    fetch: createFetcher('canDeposit'),
  },
  {
    stateKey: 'bufferedEther',
    updateEvents: ['Unbuffered'],
    fetch: createFetcher('getBufferedEther'),
  },
  {
    stateKey: 'depositableEther',
    updateEvents: [],
    fetch: createFetcher('getDepositableEther'),
  },
  {
    stateKey: 'totalPooledEther',
    updateEvents: [],
    fetch: createFetcher('getTotalPooledEther'),
  },
  {
    stateKey: 'totalELRewardsCollected',
    updateEvents: ['ELRewardsReceived'],
    fetch: createFetcher('getTotalELRewardsCollected'),
  },
  { stateKey: 'fee', updateEvents: [], fetch: createFetcher('getFee') },
  {
    stateKey: 'feeDistribution',
    updateEvents: [],
    fetch: createFetcher('getFeeDistribution'),
  },
  {
    stateKey: 'withdrawalCredentials',
    updateEvents: [],
    fetch: createFetcher('getWithdrawalCredentials'),
  },
  {
    stateKey: 'beaconStat',
    updateEvents: ['CLValidatorsUpdated', 'DepositedValidatorsChanged'],
    fetch: createFetcher('getBeaconStat'),
  },
  {
    stateKey: 'treasury',
    updateEvents: [],
    fetch: createFetcher('getTreasury'),
  },
  {
    stateKey: 'legacyOracle',
    updateEvents: [],
    fetch: createFetcher('getOracle'),
  },
  {
    stateKey: 'recoveryVault',
    updateEvents: [],
    fetch: createFetcher('getRecoveryVault'),
  },
  {
    stateKey: 'lidoLocator',
    updateEvents: ['LidoLocatorSet'],
    fetch: createFetcher('getLidoLocator'),
  },
  {
    stateKey: 'symbol',
    updateEvents: [],
    fetch: createFetcher('symbol'),
  },
  {
    stateKey: 'decimals',
    updateEvents: [],
    fetch: createFetcher('decimals'),
  },
  {
    stateKey: 'totalSupply',
    updateEvents: [],
    fetch: createFetcher('totalSupply'),
  },
  {
    stateKey: 'stakeLimitFullInfo',
    updateEvents: [
      'StakingPaused',
      'StakingResumed',
      'StakingLimitSet',
      'StakingLimitRemoved',
    ],
    fetch: createFetcher('getStakeLimitFullInfo'),
  },
  {
    stateKey: 'contractVersion',
    updateEvents: ['ContractVersionSet'],
    fetch: createFetcher('getContractVersion'),
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
]

const locatorVariables = [
  "accountingOracle",
  "burner",
  "depositSecurityModule",
  "elRewardsVault",
  "lido",
  "oracleDaemonConfig",
  "oracleReportSanityChecker",
  "postTokenRebaseReceiver",
  "stakingRouter",
  "validatorsExitBusOracle",
  "withdrawalQueue",
  "withdrawalVault"
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

    // fetch addresses from LidoLocator

    const { lidoLocator } = updatedState

    const locator = app.external(lidoLocator, LocatorABI)
    const locatorPromises = locatorVariables.map(f => locator[f]().toPromise())

    const settledLocatorPromises = await Promise.allSettled(locatorPromises)

    const locations = settledLocatorPromises.reduce((locationsObject, cur, index) => {
      locationsObject[locatorVariables[index]] = cur.value
      return locationsObject
    }, {})


    return {
      ...cachedState,
      ...updatedState,
      ...locations
    }
  }
}
