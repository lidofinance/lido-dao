export * from './getApmOptions'
export * from './getLocalWeb3'
export * from './getAccounts'
export * from './constants'

export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}