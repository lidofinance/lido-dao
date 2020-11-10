const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-web3')
usePlugin('@nomiclabs/buidler-truffle5')
usePlugin('@nomiclabs/buidler-ganache')
usePlugin('buidler-gas-reporter')
usePlugin('solidity-coverage')

let stateByNetId
try {
  stateByNetId = require('./deployed.json')
} catch (err) {
  stateByNetId = {networks: {}}
}

const getNetState = netId => stateByNetId.networks[netId] || {}

module.exports = {
  defaultNetwork: process.env.NETWORK_NAME || 'buidlerevm',
  networks: {
    localhost: {
      url: 'http://localhost:8545',
      chainId: 1337,
      ensAddress: getNetState('1337').ensAddress,
      accounts: 'remote',
      timeout: 60000
    },
    coverage: {
      url: 'http://localhost:8555'
    }
  },
  solc: {
    version: '0.4.24',
    optimizer: {
      enabled: true,
      runs: 200
    },
    evmVersion: 'constantinople'
  },
  paths: {
    sources: './contracts/0.4.24',
    cache: './cache/v4'
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: 'USD'
  }
}
