const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-web3')
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
