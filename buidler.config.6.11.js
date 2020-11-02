const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-truffle5')
usePlugin('@nomiclabs/buidler-ganache')
usePlugin('buidler-gas-reporter')
usePlugin('solidity-coverage')

module.exports = {
  networks: {
    localhost: {
      url: 'http://localhost:8545'
    },
    coverage: {
      url: 'http://localhost:8555'
    }
  },
  solc: {
    version: '0.6.11',
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  paths: {
    sources: './contracts/0.6.11',
    cache: './cache/v6'
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: 'USD'
  }
}
