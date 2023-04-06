import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import LidoABI from "./abi/Lido.abi.json"
import LidoLocatorABI from "./abi/LidoLocator.abi.json"
import AccountingOracleABI from "./abi/AccountingOracle.abi.json"
import HashConsensusABI from "./abi/HashConsensus.abi.json"

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


const hashConsensusState = [
  {
    appStateKey: "chainConfig",
    contractFunction: "getChainConfig"
  },
  {
    appStateKey: "consensusState",
    contractFunction: "getConsensusState"
  },
  {
    appStateKey: "currentFrame",
    contractFunction: "getCurrentFrame"
  },
  {
    appStateKey: "fastLaneMembers",
    contractFunction: "getFastLaneMembers"
  },
  {
    appStateKey: "frameConfig",
    contractFunction: "getFrameConfig"
  },
  {
    appStateKey: "initialRefSlot",
    contractFunction: "getInitialRefSlot"
  },
  {
    appStateKey: "members",
    contractFunction: "getMembers"
  },
  {
    appStateKey: "quorum",
    contractFunction: "getQuorum"
  },
  {
    appStateKey: "reportProcessor",
    contractFunction: "getReportProcessor"
  },
  {
    appStateKey: "reportVariants",
    contractFunction: "getReportVariants"
  }
]

function initializeState() {
  return async (cachedState) => {

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


    const { consensusContract } = aoState
    const hashConsensusContract = app.external(consensusContract, HashConsensusABI)
    const hcPromises = hashConsensusState.map(({ contractFunction }) => hashConsensusContract[contractFunction]().toPromise())
    const settledHcPromises = await Promise.allSettled(hcPromises)
    const hcState = settledHcPromises.reduce((stateObject, cur, index) => {
      stateObject[hashConsensusState[index].appStateKey] = cur.value
      return stateObject
    }, {})

    const memberPromises = hcState.members.addresses.map((memberAddress) => hashConsensusContract.getConsensusStateForMember(memberAddress).toPromise())
    const settledMemberPromises = await Promise.allSettled(memberPromises)


    hcState.memberDetails = settledMemberPromises.reduce((stateArray, cur, index) => {
      stateArray.push({
        ...cur.value,
        address: hcState.members.addresses[index]
      })
      return stateArray
    }, [])

    return {
      ...cachedState,
      lido,
      ...aoState,
      ...hcState
    }
  }
}
