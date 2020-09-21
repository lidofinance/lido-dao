export * from './getApmOptions'
export * from './getLocalWeb3'
export * from './getAccounts'

export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}