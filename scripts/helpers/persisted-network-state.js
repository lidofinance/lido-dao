const fs = require('fs')

const { log } = require('./log')

const stateByFilename = {}

function readNetworkState(fileName, netId) {
  log(`Reading network state from ${fileName}...`)
  const state = _readNetworkStateFile(fileName)
  return (state.networks || {})[netId] || {}
}

function _readNetworkStateFile(fileName) {
  try {
    if (!fs.existsSync(fileName)) {
      return {}
    }
    const data = fs.readFileSync(fileName, 'utf8')
    return (stateByFilename[fileName] = JSON.parse(data))
  } catch (err) {
    throw new Error(`malformed network state file ${fileName} (${err.message})`)
  }
}

function persistNetworkState(fileName, netId, netState, updates = undefined) {
  if (updates) {
    updateNetworkState(netState, updates)
  }
  log(`Writing network state to ${fileName}...`)
  const state = stateByFilename[fileName] || _readNetworkStateFile(fileName)
  const networks = state.networks || (state.networks = {})
  networks[netId] = netState
  stateByFilename[fileName] = state
  const data = JSON.stringify(state, null, '  ') + '\n'
  fs.writeFileSync(fileName, data, 'utf8')
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

module.exports = { readNetworkState, persistNetworkState, updateNetworkState, assertRequiredNetworkState }
