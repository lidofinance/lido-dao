require('dotenv').config()
const path = require('path')
const { readNetworkState, persistNetworkState } = require('../../scripts/helpers/persisted-network-state')

const NET_ID = process.argv[2] || '2020'
const BACKUP_PATH = process.argv[3] || '../snapshots'
const STATE_PATH = process.argv[4] || '../..'
const NETWORK_STATE_FILE = process.argv[5] || 'deployed.json'

const main = async ({ netId = NET_ID, networkStateFile = NETWORK_STATE_FILE, statePath = STATE_PATH, backupPath = BACKUP_PATH } = {}) => {
  const stateFile = path.resolve(__dirname, statePath, networkStateFile)
  const backupFile = path.resolve(__dirname, backupPath, networkStateFile)
  const state = readNetworkState(backupFile, netId)
  persistNetworkState(stateFile, netId, state)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.log(e)
    process.exit(1)
  })
