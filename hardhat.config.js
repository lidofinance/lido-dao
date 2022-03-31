const fs = require('fs')
const path = require('path')

require('@aragon/hardhat-aragon')
require('@nomiclabs/hardhat-web3')
require('@nomiclabs/hardhat-ethers')
require('@nomiclabs/hardhat-truffle5')
require('@nomiclabs/hardhat-ganache')
require('@nomiclabs/hardhat-etherscan')
require('hardhat-gas-reporter')
require('solidity-coverage')
require('hardhat-contract-sizer')

const NETWORK_NAME = getNetworkName()
const ETH_ACCOUNT_NAME = process.env.ETH_ACCOUNT_NAME

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

const accounts = readJson(`./accounts.json`) || {
  eth: { dev: 'remote' },
  etherscan: { apiKey: undefined },
  infura: { projectId: undefined },
  infura_ipfs: { projectId: undefined, projectSecret: undefined }
}

const getNetConfig = (networkName, ethAccountName) => {
  const netState = readJson(`./deployed-${networkName}.json`) || {}
  const ethAccts = accounts.eth || {}
  const base = {
    accounts: ethAccountName === 'remote' ? 'remote' : ethAccts[ethAccountName] || ethAccts[networkName] || ethAccts.dev || 'remote',
    ensAddress: netState.ensAddress,
    timeout: 60000
  }
  const localhost = {
    ...base,
    url: 'http://localhost:8545',
    chainId: 31337,
    gas: 8000000 // the same as in Görli
  }
  const byNetName = {
    localhost,
    kintsugi: {
      ...base,
      accounts: accounts.eth.kintsugi,
      // url: '	https://rpc.kintsugi.themerge.dev',
      // url: 'http://kintsugi.testnet.fi/eth1rpc',
      // url: 'http://108.61.179.232:8545',
      url: 'http://kintsugi.testnet.fi:8545',
      chainId: 1337702,
      // gas: 10000000,
      gasPrice: 2000000000
    },
    kiln: {
      ...base,
      accounts: accounts.eth.kiln,
      url: 'http://34.159.167.0:8545',
      chainId: 1337802,
      // gas: 10000000,
      gasPrice: 2000000000
    },
    // local
    local: {
      ...base,
      accounts: {
        mnemonic: 'explain tackle mirror kit van hammer degree position ginger unfair soup bonus'
      },
      url: 'http://localhost:8545',
      chainId: 1337
    },
    hardhat: {
      blockGasLimit: 20000000,
      gasPrice: 0,
      initialBaseFeePerGas: 0,
      allowUnlimitedContractSize: true,
      accounts: {
        mnemonic: 'hardhat',
        count: 20,
        accountsBalance: '100000000000000000000000',
        gasPrice: 0
      }
    },
    'goerli-pyrmont': {
      ...base,
      url: 'http://206.81.31.11/rpc',
      chainId: 5
    },
    rinkeby: {
      ...base,
      url: 'https://rinkeby.infura.io/v3/' + accounts.infura.projectId,
      chainId: 4,
      timeout: 60000 * 10
    },
    goerli: {
      ...base,
      url: 'https://goerli.infura.io/v3/' + accounts.infura.projectId,
      chainId: 5,
      timeout: 60000 * 10
    },
    'mainnet-test': {
      ...base,
      url: 'https://mainnet.infura.io/v3/' + accounts.infura.projectId,
      chainId: 1,
      timeout: 60000 * 10
    },
    mainnet: {
      ...base,
      url: 'https://mainnet.infura.io/v3/' + accounts.infura.projectId,
      chainId: 1,
      timeout: 60000 * 10
    },
    fork: {
      ...base,
      chainId: 1,
      timeout: 60000 * 10,
      forking: {
        url: 'https://mainnet.infura.io/v3/' + accounts.infura.projectId
        // url: 'https://eth-mainnet.alchemyapi.io/v2/' + accounts.alchemy.apiKey
      }
    }
  }
  const netConfig = byNetName[networkName]
  return netConfig ? { [networkName]: netConfig } : {}
}

const solcSettings4 = {
  optimizer: {
    enabled: true,
    runs: 200
  },
  evmVersion: 'constantinople'
}
const solcSettings6 = {
  optimizer: {
    enabled: true,
    runs: 200
  },
  evmVersion: 'istanbul'
}
const solcSettings8 = {
  optimizer: {
    enabled: true,
    runs: 200
  },
  evmVersion: 'istanbul'
}

module.exports = {
  defaultNetwork: NETWORK_NAME,
  networks: getNetConfig(NETWORK_NAME, ETH_ACCOUNT_NAME),
  solidity: {
    compilers: [
      {
        version: '0.4.24',
        settings: solcSettings4
      },
      {
        version: '0.6.11',
        settings: solcSettings6
      },
      {
        version: '0.6.12',
        settings: solcSettings6
      },
      {
        version: '0.8.9',
        settings: solcSettings8
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
    ipfsApi: process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0',
    ipfsGateway: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/'
  },
  ipfs: {
    url: process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0',
    gateway: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/',
    pinata: {
      key: 'YOUR_PINATA_API_KEY',
      secret: 'YOUR_PINATA_API_SECRET_KEY'
    }
  }
}

function getNetworkName() {
  if (process.env.HARDHAT_NETWORK) {
    // Hardhat passes the network to its subprocesses via this env var
    return process.env.HARDHAT_NETWORK
  }
  const networkArgIndex = process.argv.indexOf('--network')
  return networkArgIndex !== -1 && networkArgIndex + 1 < process.argv.length
    ? process.argv[networkArgIndex + 1]
    : process.env.NETWORK_NAME || 'hardhat'
}

function readJson(fileName) {
  let data
  try {
    const filePath = path.join(__dirname, fileName)
    data = fs.readFileSync(filePath)
  } catch (err) {
    return null
  }
  return JSON.parse(data)
}

if (typeof task === 'function') {
  require('./scripts/hardhat-tasks')
}
