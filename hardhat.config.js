const fs = require('fs')
const path = require('path')

require('@nomiclabs/hardhat-web3')
require('@nomiclabs/hardhat-truffle5')
require('@nomiclabs/hardhat-ganache')
require('@nomiclabs/hardhat-etherscan')
require('hardhat-gas-reporter')
// require('solidity-coverage')

const accounts = readJson('./accounts.json') || {
  eth: 'remote',
  etherscan: { apiKey: undefined }
}

const stateByNetId = readJson('./deployed.json') || {
  networks: {}
}

const getNetState = (netId) => stateByNetId.networks[netId] || {}

const solcSettings = {
  optimizer: {
    enabled: true,
    runs: 200
  },
  evmVersion: 'constantinople'
}

module.exports = {
  defaultNetwork: process.env.NETWORK_NAME || 'hardhat',
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
  solidity: {
    compilers: [
      {
        version: '0.4.24',
        settings: solcSettings
      },
      {
        version: '0.6.11',
        settings: solcSettings
      },
      {
        version: '0.6.12',
        settings: solcSettings
      }
    ],
    overrides: {
      'contracts/0.6.11/deposit_contract.sol': {
        version: '0.6.11',
        settings: {
          optimizer: {
            enabled: true,
            runs: 5000000 // https://etherscan.io/address/0x00000000219ab540356cbb839cbe05303d7705fa#code
          }
        }
      }
    }
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: 'USD'
  },
  etherscan: accounts.etherscan,
  aragon: {
    ipfsApi: process.env.IPFS_API_URL || 'https://goerli.lido.fi/ipfs-api/v0',
    ipfsGateway: process.env.IPFS_GATEWAY_URL || 'https://goerli.lido.fi'
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
