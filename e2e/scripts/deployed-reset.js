require('dotenv').config()
const path = require('path')
const { persistNetworkState } = require('../../scripts/helpers/persisted-network-state')

const NET_ID = process.argv[2] || '2020'
const NET_NAME = process.argv[3] || 'e2e'
const OWNER = process.argv[4] || ''
const HOLDERS = process.argv[5] || ''
const STATE_PATH = process.argv[6] || '../..'
const NETWORK_STATE_FILE = process.argv[7] || 'deployed.json'
const DEFAULT_STAKE = '100000000000000000000' // 100e18
const DEFAULT_DAO_SETTINGS = {
  holders: [],
  stakes: [],
  tokenName: 'Lido DAO Token',
  tokenSymbol: 'LDO',
  voteDuration: 60 * 3, // 3 minutes
  votingSupportRequired: '500000000000000000', // 50e16 basis points === 50%
  votingMinAcceptanceQuorum: '50000000000000000' // 5e16 basis points === 5%
}

const main = async ({
  netId = NET_ID,
  networkName = NET_NAME,
  networkStateFile = NETWORK_STATE_FILE,
  statePath = STATE_PATH,
  owner = OWNER,
  holders = HOLDERS.split(',')
} = {}) => {
  const stateFile = path.resolve(__dirname, statePath, networkStateFile)
  const state = {
    networkName,
    owner,
    daoInitialSettings: {
      ...DEFAULT_DAO_SETTINGS,
      holders,
      stakes: Array(holders.length).fill(DEFAULT_STAKE)
    }
  }
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
