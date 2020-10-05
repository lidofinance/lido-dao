import 'core-js/stable'
import 'regenerator-runtime/runtime'
import Aragon, { events } from '@aragon/api'
import {
  getFee,
  getFeeDistribution,
  getWithdrawalCredentials,
  getBufferedEther,
  getEther2Stat,
  getInsuranceFund,
  getOracle,
  getSPs,
  getToken,
  getTotalControlledEther,
  getTreasury,
  getValidatorRegistrationContract,
} from './api'

const app = new Aragon()

app.store(
  async (state, { event }) => {
    const nextState = {
      ...state,
    }

    console.log('reducer', event)

    try {
      switch (event) {
        case 'FeeSet':
          return { ...nextState, fee: await getFee() }
        case 'FeeDistributionSet':
          return { ...nextState, feeDistribution: await getFeeDistribution() }
        case 'WithdrawalCredentialsSet':
          return { ...nextState, withdrawalCredentials: await getWithdrawalCredentials() }
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
      fee: await getFee(),
      // feeDistribution: await getFeeDistribution(),
      withdrawalCredentials: await getWithdrawalCredentials(),
      bufferedEther: await getBufferedEther(),
      totalControlledEther: await getTotalControlledEther(),
      token: await getToken(),
      // validatorRegistrationContract: await getValidatorRegistrationContract(),
      oracle: await getOracle(),
      // SPs: await getSPs(),
      // treasury: await getTreasury(),
      // insuranceFund: await getInsuranceFund(),
      ether2Stat: await getEther2Stat(),
    }
  }
}
