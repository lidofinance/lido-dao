const fs = require('fs')
const path = require('path')
const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-web3')
usePlugin('@nomiclabs/buidler-truffle5')
usePlugin('@nomiclabs/buidler-ganache')
usePlugin('@nomiclabs/buidler-etherscan')
usePlugin('buidler-gas-reporter')
usePlugin('solidity-coverage')

const accounts = readJson('./accounts.json') || {
  eth: 'remote',
  etherscan: { apiKey: undefined }
}

const stateByNetId = readJson('./deployed.json') || {
  networks: {}
}

const getNetState = (netId) => stateByNetId.networks[netId] || {}

module.exports = {
  defaultNetwork: process.env.NETWORK_NAME || 'buidlerevm',
  networks: {
    localhost: {
      url: 'http://localhost:8545',
      chainId: 1337,
      ensAddress: getNetState('1337').ensAddress,
      accounts: 'remote',
      timeout: 60000,
      gas: 8000000 // the same as in Göerli
    },
    e2e: {
      url: 'http://localhost:8545',
      chainId: 1337,
      ensAddress: getNetState('2020').ensAddress,
      accounts: accounts.e2e || 'remote',
      timeout: 60000,
      gas: 8000000 // the same as in Göerli
    },
    coverage: {
      url: 'http://localhost:8555'
    },
    goerli: {
      url: 'http://206.81.31.11/rpc',
      chainId: 5,
      ensAddress: getNetState('5').ensAddress,
      timeout: 60000 * 10,
      accounts: accounts.eth,
      gasPrice: 2000000000
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
  },
  etherscan: accounts.etherscan,
  aragon: {
    ipfsApi: process.env.IPFS_API_URL || 'http://206.81.31.11/ipfs-api/v0',
    ipfsGateway: process.env.IPFS_GATEWAY_URL || 'http://206.81.31.11'
  }
}

function readJson(fileName) {
  try {
    const filePath = path.join(__dirname, fileName)
    return JSON.parse(fs.readFileSync(filePath))
  } catch (err) {
    return null
  }
}
