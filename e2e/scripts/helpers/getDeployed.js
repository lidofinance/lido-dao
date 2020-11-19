import { resolve } from 'path'
import { readNetworkState } from '../../../scripts/helpers/persisted-network-state'

const NET_ID = '2020'
const STATE_PATH = '../../..'
const NETWORK_STATE_FILE = 'deployed.json'

let stateCache

export const getDeployedState = ({ netId = NET_ID, networkStateFile = NETWORK_STATE_FILE, statePath = STATE_PATH } = {}) => {
  const stateFile = resolve(__dirname, statePath, networkStateFile)
  return (stateCache = readNetworkState(stateFile, netId))
}

export const getDeployedParam = (param, opts) => {
  return (stateCache && stateCache[param]) || getDeployedState(opts)[param]
}

export default getDeployedParam
