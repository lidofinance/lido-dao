const fs = require('fs')
const path = require('path')

const { log } = require('./log')

const NETWORK_STATE_FILE_BASENAME = process.env.NETWORK_STATE_FILE_BASENAME || 'deployed'
const NETWORK_STATE_FILE_DIR = process.env.NETWORK_STATE_FILE_DIR || '.'

function readNetworkState(netName, netId) {
  const fileName = _getFileName(netName, NETWORK_STATE_FILE_BASENAME, NETWORK_STATE_FILE_DIR)
  log(`Reading network state from ${fileName}...`)
  const state = _readNetworkStateFile(fileName, netId)
  if (state.networkId !== netId) {
    throw new Error(`network id (${netId}) doesn't match the one in the state file (${state.networkId})`)
  }
  return state
}

function persistNetworkState(netName, netId, state, updates = undefined) {
  state.networkId = netId
  if (updates) {
    updateNetworkState(state, updates)
  }
  const fileName = _getFileName(netName, NETWORK_STATE_FILE_BASENAME, NETWORK_STATE_FILE_DIR)
  log(`Writing network state to ${fileName}...`)
  _writeNetworkStateFile(fileName, state)
}

function updateNetworkState(state, newState) {
  Object.keys(newState).forEach((key) => {
    const value = newState[key]
    if (value != null) {
      if (value.address) {
        state[`${key}Address`] = value.address
        if (value.constructorArgs) {
          state[`${key}ConstructorArgs`] = value.constructorArgs
        }
      } else {
        state[key] = value
      }
    }
  })
}

function assertRequiredNetworkState(state, requiredStateNames) {
  const missingState = requiredStateNames.filter((key) => !state[key])
  if (missingState.length) {
    const missingDesc = missingState.join(', ')
    throw new Error(
      `missing following fields from the network state file, make sure you've run ` + `previous deployment steps: ${missingDesc}`
    )
  }
}

function _getFileName(netName, baseName, dir) {
  return path.resolve(dir, `${baseName}-${netName}.json`)
}

function _readNetworkStateFile(fileName, netId) {
  if (!fs.existsSync(fileName)) {
    const state = { networkId: netId }
    _writeNetworkStateFile(fileName, state)
    return state
  }
  const data = fs.readFileSync(fileName, 'utf8')
  try {
    return JSON.parse(data)
  } catch (err) {
    throw new Error(`malformed network state file ${fileName}: ${err.message}`)
  }
}

function _writeNetworkStateFile(fileName, state) {
  const data = JSON.stringify(state, null, '  ')
  fs.writeFileSync(fileName, data + '\n', 'utf8')
}

module.exports = { readNetworkState, persistNetworkState, updateNetworkState, assertRequiredNetworkState }
