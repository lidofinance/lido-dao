const fs = require('fs')

const {log} = require('./log')

let stateByFilename = {}

function readNetworkState(fileName, netId) {
  log(`Reading network state from ${fileName}...`)
  const state = _readNetworkStateFile(fileName)
  return (state.networks || {})[netId] || {}
}

function _readNetworkStateFile(fileName) {
  try {
    const data = fs.readFileSync(fileName, 'utf8')
    return stateByFilename[fileName] = JSON.parse(data)
  } catch (err) {
    throw new Error(`missing or malformed network state file ${fileName} (${err.message})`)
  }
}

function persistNetworkState(fileName, netId, newState) {
  log(`Writing network state to ${fileName}...`)
  const state = stateByFilename[fileName] || _readNetworkStateFile(fileName)
  const networks = state.networks || (state.networks = {})
  networks[netId] = newState
  stateByFilename[fileName] = state
  const data = JSON.stringify(state, null, '  ') + '\n'
  fs.writeFileSync(fileName, data, 'utf8')
}

function updateNetworkState(state, newState) {
  Object.keys(newState).forEach(key => {
    const value = newState[key]
    if (value != null) {
      if (value.address) {
        state[`${key}Address`] = value.address
      } else {
        state[key] = value
      }
    }
  })
}

module.exports = {readNetworkState, persistNetworkState, updateNetworkState}
