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
        case 'FeeSet':
          return { ...nextState, fee: await getFee() }
        case 'FeeDistributionSet':
          return { ...nextState, feeDistribution: await getFeeDistribution() }
        case 'WithdrawalCredentialsSet':
          return {
            ...nextState,
            withdrawalCredentials: await getWithdrawalCredentials(),
          }
        case 'ELRewardsWithdrawalLimitSet':
          return {
            ...nextState,
            elRewardsWithdrawalLimit: await getElRewardsWithdrawalLimit(),
          }
        case 'ELRewardsVaultSet':
          return {
            ...nextState,
            elRewardsVault: await getElRewardsVault(),
          }
        case 'Unbuffered':
          return { ...nextState, bufferedEther: await getBufferedEther() }
        case 'StakingPaused':
          return { ...nextState, stakingLimitInfo: await getStakingLimitInfo() }
        case 'StakingResumed':
          return { ...nextState, stakingLimitInfo: await getStakingLimitInfo() }
        case 'StakingLimitSet':
          return { ...nextState, stakingLimitInfo: await getStakingLimitInfo() }
        case 'StakingLimitRemoved':
          return { ...nextState, stakingLimitInfo: await getStakingLimitInfo() }
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
    // fetch in parallel
    const allSettled = await Promise.allSettled([
      getIsStopped(),
      getFee(),
      getFeeDistribution(),
      getWithdrawalCredentials(),
      getElRewardsWithdrawalLimit(),
      getElRewardsVault(),
      getBufferedEther(),
      getTotalPooledEther(),
      getNodeOperatorsRegistry(),
      getDepositContract(),
      getOracle(),
      getOperators(),
      getTreasury(),
      getInsuranceFund(),
      getBeaconStat(),
      getStakingLimitInfo(),
    ])

    const [
      isStopped,
      fee,
      feeDistribution,
      withdrawalCredentials,
      elRewardsWithdrawalLimit,
      elRewardsVault,
      bufferedEther,
      totalPooledEther,
      nodeOperatorsRegistry,
      depositContract,
      oracle,
      operators,
      treasury,
      insuranceFund,
      beaconStat,
      stakingLimitInfo,
    ] = allSettled.map((settled) => settled.value)

    return {
      ...cachedState,
      isStopped,
      fee,
      feeDistribution,
      withdrawalCredentials,
      elRewardsWithdrawalLimit,
      elRewardsVault,
      bufferedEther,
      totalPooledEther,
      nodeOperatorsRegistry,
      depositContract,
      oracle,
      operators,
      treasury,
      insuranceFund,
      beaconStat,
      stakingLimitInfo,
    }
  }
}

// API
function getIsStopped() {
  return app.call('isStopped').toPromise()
}

function getFee() {
  return app.call('getFee').toPromise()
}

function getFeeDistribution() {
  return app.call('getFeeDistribution').toPromise()
}

function getWithdrawalCredentials() {
  return app.call('getWithdrawalCredentials').toPromise()
}

function getElRewardsWithdrawalLimit() {
  return app.call('getELRewardsWithdrawalLimit').toPromise()
}

function getElRewardsVault() {
  return app.call('getELRewardsVault').toPromise()
}

function getBufferedEther() {
  return app.call('getBufferedEther').toPromise()
}

function getTotalPooledEther() {
  return app.call('getTotalPooledEther').toPromise()
}

function getNodeOperatorsRegistry() {
  return app.call('getOperators').toPromise()
}

function getDepositContract() {
  return app.call('getDepositContract').toPromise()
}

function getOracle() {
  return app.call('getOracle').toPromise()
}

function getOperators() {
  return app.call('getOperators').toPromise()
}

function getTreasury() {
  return app.call('getTreasury').toPromise()
}

function getInsuranceFund() {
  return app.call('getInsuranceFund').toPromise()
}

function getBeaconStat() {
  return app.call('getBeaconStat').toPromise()
}

function getStakingLimitInfo() {
  return app.call('getStakeLimitFullInfo').toPromise()
}
