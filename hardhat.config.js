const fs = require('fs')
const path = require('path')
const { TASK_COMPILE } = require('hardhat/builtin-tasks/task-names')

require('@aragon/hardhat-aragon')
require('@nomiclabs/hardhat-web3')
require('@nomiclabs/hardhat-ethers')
require('@nomiclabs/hardhat-truffle5')
require('@nomiclabs/hardhat-ganache')
require('@nomiclabs/hardhat-etherscan')
require('hardhat-gas-reporter')
require('solidity-coverage')
require('hardhat-contract-sizer')
require('hardhat-ignore-warnings')
require('./foundry/skip-sol-tests-compilation')

const NETWORK_NAME = getNetworkName()
const ETH_ACCOUNT_NAME = process.env.ETH_ACCOUNT_NAME

// eslint-disable-next-line no-undef
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
  infura_ipfs: { projectId: undefined, projectSecret: undefined },
}

const getNetConfig = (networkName, ethAccountName) => {
  const netState = readJson(`./deployed-${networkName}.json`) || {}
  const ethAccts = accounts.eth || {}
  const base = {
    accounts:
      ethAccountName === 'remote'
        ? 'remote'
        : ethAccts[ethAccountName] || ethAccts[networkName] || ethAccts.dev || 'remote',
    ensAddress: netState.ensAddress,
    timeout: 60000,
  }
  const byNetName = {
    mainnetfork: {
      ...base,
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID) || 1,
    },
    goerlifork: {
      ...base,
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID) || 5,
    },
    local: {
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID) || 1337,
    },
    hardhat: {
      // NB!: forking get enabled if env variable HARDHAT_FORKING_URL is set, see code below
      blockGasLimit: 30000000,
      gasPrice: 0,
      initialBaseFeePerGas: 0,
      allowUnlimitedContractSize: true,
      accounts: {
        // default hardhat's node mnemonic
        mnemonic: 'test test test test test test test test test test test junk',
        count: 10,
        accountsBalance: '100000000000000000000000',
        gasPrice: 0,
      },
    },
    goerli: {
      ...base,
      // url: 'https://goerli.infura.io/v3/' + process.env.WEB3_INFURA_PROJECT_ID,
      url: process.env.RPC_URL,
      chainId: 5,
      timeout: 60000 * 10,
    },
    goerlidebug: {
      ...base,
      url: process.env.RPC_URL,
      chainId: 5,
      timeout: 60000 * 15,
    },
    mainnet: {
      ...base,
      url: 'https://mainnet.infura.io/v3/' + accounts.infura.projectId,
      chainId: 1,
      timeout: 60000 * 10,
    },
    fork: {
      ...base,
      chainId: 1,
      timeout: 60000 * 10,
      forking: {
        url: 'https://mainnet.infura.io/v3/' + accounts.infura.projectId,
        // url: 'https://eth-mainnet.alchemyapi.io/v2/' + accounts.alchemy.apiKey
      },
    },
  }
  const netConfig = byNetName[networkName]
  if (networkName === 'hardhat' && process.env.HARDHAT_FORKING_URL) {
    netConfig.forking = { url: process.env.HARDHAT_FORKING_URL }
  }
  return netConfig ? { [networkName]: netConfig } : {}
}

const solcSettings4 = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
  evmVersion: 'constantinople',
}
const solcSettings6 = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
  evmVersion: 'istanbul',
}
const solcSettings8 = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
  evmVersion: 'istanbul',
}

module.exports = {
  defaultNetwork: NETWORK_NAME,
  networks: getNetConfig(NETWORK_NAME, ETH_ACCOUNT_NAME),
  solidity: {
    compilers: [
      {
        version: '0.4.24',
        settings: solcSettings4,
      },
      {
        version: '0.6.11',
        settings: solcSettings6,
      },
      {
        version: '0.6.12',
        settings: solcSettings6,
      },
      {
        version: '0.8.9',
        settings: solcSettings8,
      },
    ],
    overrides: {
      'contracts/0.6.11/deposit_contract.sol': {
        version: '0.6.11',
        settings: {
          optimizer: {
            enabled: true,
            runs: 5000000, // https://etherscan.io/address/0x00000000219ab540356cbb839cbe05303d7705fa#code
          },
        },
      },
      'contracts/0.4.24/test_helpers/MinFirstAllocationStrategyConsumerMockLegacyVersion.sol': {
        version: '0.4.24',
        settings: {},
      },
    },
  },
  warnings: {
    '@aragon/**/*': {
      default: 'off',
    },
    'contracts/*/test_helpers/**/*': {
      default: 'off',
    },
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: 'USD',
  },
  etherscan: accounts.etherscan,
  aragon: {
    ipfsApi: process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0',
    ipfsGateway: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/',
  },
  ipfs: {
    url: process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0',
    gateway: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/',
    pinata: {
      key: 'YOUR_PINATA_API_KEY',
      secret: 'YOUR_PINATA_API_SECRET_KEY',
    },
  },
  contractSizer: {
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    except: ['test_helpers', 'template', 'mocks', '@aragon', 'openzeppelin'],
  },
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

// eslint-disable-next-line no-undef
task(TASK_COMPILE).setAction(async function (args, hre, runSuper) {
  for (const compiler of hre.config.solidity.compilers) {
    compiler.settings.outputSelection['*']['*'].push('userdoc')
  }
  await runSuper()
})

// eslint-disable-next-line no-undef
task('userdoc', 'Generate userdoc JSON files', async function (args, hre) {
  await hre.run('compile')

  const contractNames = await hre.artifacts.getAllFullyQualifiedNames()
  const dirPath = path.join(__dirname, '/artifacts-userdoc')

  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }

  fs.mkdirSync(dirPath)

  const contractHandlers = contractNames.map((contractName) =>
    (async () => {
      const [source, name] = contractName.split(':')
      const { userdoc } = (await hre.artifacts.getBuildInfo(contractName)).output.contracts[source][name]

      if (
        !userdoc ||
        (Object.values(userdoc.methods || {}).length === 0 && Object.values(userdoc.events || {}).length === 0)
      ) {
        return
      }

      const filePath = path.join(dirPath, `${name}.json`)
      await fs.promises.writeFile(filePath, JSON.stringify(userdoc, null, 2))
    })()
  )

  await Promise.all(contractHandlers)
})
