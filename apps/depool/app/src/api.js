import Aragon from '@aragon/api'

const app = new Aragon()

export async function getFee() {
  return await app.call('getFee').toPromise()
}

export async function getFeeDistribution() {
  return await app.call('getFeeDistribution').toPromise().catch(console.log)
}

export async function getWithdrawalCredentials() {
  return await app.call('getWithdrawalCredentials').toPromise()
}

export async function getBufferedEther() {
  return await app.call('getBufferedEther').toPromise()
}

export async function getTotalControlledEther() {
  return await app.call('getTotalControlledEther').toPromise()
}

export async function getToken() {
  return await app.call('getToken').toPromise()
}

export async function getValidatorRegistrationContract() {
  return await app.call('getValidatorRegistrationContract').toPromise()
}

export async function getOracle() {
  return await app.call('getOracle').toPromise()
}

export async function getSPs() {
  return await app.call('getSPs').toPromise()
}

export async function getTreasury() {
  return await app.call('getTreasury').toPromise()
}

export async function getInsuranceFund() {
  return await app.call('getInsuranceFund').toPromise()
}

export async function getEther2Stat() {
  return await app.call('getEther2Stat').toPromise()
}
