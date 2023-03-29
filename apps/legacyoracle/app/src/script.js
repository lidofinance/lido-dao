import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import LidoABI from "./abi/Lido.abi.json"
import LidoLocatorABI from "./abi/LidoLocator.abi.json"
import AccountingOracleABI from "./abi/AccountingOracle.abi.json"

const app = new Aragon()

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

const accountingOracleState = [
  {
    appStateKey: "extraDataFormatEmpty",
    contractFunction: "EXTRA_DATA_FORMAT_EMPTY"
  },
  {
    appStateKey: "extraDataFormatList",
    contractFunction: "EXTRA_DATA_FORMAT_LIST"
  },
  {
    appStateKey: "extraDataTypeExitedValidators",
    contractFunction: "EXTRA_DATA_TYPE_EXITED_VALIDATORS"
  },
  {
    appStateKey: "extraDataTypeStuckValidators",
    contractFunction: "EXTRA_DATA_TYPE_STUCK_VALIDATORS"
  },
  {
    appStateKey: "genesisTime",
    contractFunction: "GENESIS_TIME"
  },
  {
    appStateKey: "legacyOracle",
    contractFunction: "LEGACY_ORACLE"
  },
  {
    appStateKey: "secondsPerSlot",
    contractFunction: "SECONDS_PER_SLOT"
  },
  {
    appStateKey: "consensusContract",
    contractFunction: "getConsensusContract"
  },
  {
    appStateKey: "consensusReport",
    contractFunction: "getConsensusReport"
  },
  {
    appStateKey: "consensusVersion",
    contractFunction: "getConsensusVersion"
  },
  {
    appStateKey: "contractVersion",
    contractFunction: "getContractVersion"
  },
  {
    appStateKey: "lastProcessingRefSlot",
    contractFunction: "getLastProcessingRefSlot"
  },
  {
    appStateKey: "processingState",
    contractFunction: "getProcessingState"
  },
  {
    appStateKey: "contractVersion",
    contractFunction: "getContractVersion"
  },
  {
    appStateKey: "contractVersion",
    contractFunction: "getContractVersion"
  },
]

function initializeState() {
  return async (cachedState) => {

    console.log("HELLO")
    const lido = await app.call("getLido").toPromise()
    const lidoContract = app.external(lido, LidoABI)


    const locator = await lidoContract.getLidoLocator().toPromise()
    const locatorContract = app.external(locator, LidoLocatorABI)


    const accountingOracle = await locatorContract.accountingOracle().toPromise()
    const accountingOracleContract = app.external(accountingOracle, AccountingOracleABI)
    const aoPromises = accountingOracleState.map(({ contractFunction }) => accountingOracleContract[contractFunction]().toPromise())
    const settledAoPromises = await Promise.allSettled(aoPromises)
    const aoState = settledAoPromises.reduce((stateObject, cur, index) => {
      stateObject[accountingOracleState[index].appStateKey] = cur.value
      return stateObject
    }, {})


    return {
      ...cachedState,
      lido,
      ...aoState
    }
  }
}
