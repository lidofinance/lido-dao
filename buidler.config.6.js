const fs = require('fs')
const path = require('path')

const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-truffle5')
usePlugin('@nomiclabs/buidler-ganache')
usePlugin('@nomiclabs/buidler-etherscan')
usePlugin('buidler-gas-reporter')
usePlugin('solidity-coverage')

const accounts = readJson('./accounts.json') || {
  eth: 'remote',
  etherscan: { apiKey: undefined }
}

module.exports = {
  networks: {
    localhost: {
      url: 'http://localhost:8545',
      timeout: 60000
    },
    coverage: {
      url: 'http://localhost:8555'
    },
    goerli: {
      url: 'http://206.81.31.11/rpc',
      chainId: 5
    }
  },
  solc: {
    version: '0.6.12',
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  paths: {
    sources: './contracts/0.6.12',
    cache: './cache/v6'
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: 'USD'
  },
  etherscan: accounts.etherscan
}

function readJson(fileName) {
  try {
    const filePath = path.join(__dirname, fileName)
    return JSON.parse(fs.readFileSync(filePath))
  } catch (err) {
    return null
  }
}
