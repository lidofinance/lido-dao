const { usePlugin } = require('@nomiclabs/buidler/config')
const hooks = require('./scripts/buidler-hooks')

usePlugin('@aragon/buidler-aragon')
usePlugin("@nomiclabs/buidler-ganache")
usePlugin('buidler-gas-reporter')

module.exports = {
  // Default Buidler configurations. Read more about it at https://buidler.dev/config/
  defaultNetwork: 'development',
  networks: {
    development: {
      url: 'http://localhost:8545',
    },
  },
  solc: {
    version: '0.4.24',
    optimizer: {
      enabled: true,
      runs: 10000,
    },
    evmVersion: 'constantinople'
  },
  // Etherscan plugin configuration. Learn more at https://github.com/nomiclabs/buidler/tree/master/packages/buidler-etherscan
  etherscan: {
    apiKey: '', // API Key for smart contract verification. Get yours at https://etherscan.io/apis
  },
  // Aragon plugin configuration
  aragon: {
    appServePort: 8001,
    clientServePort: 3000,
    // skip app build and publish to ipfs
    // TODO uncomment when frontend will be
    // appSrcPath: 'app/',
    appBuildOutputPath: 'dist/',
    appName: 'depool',
    hooks, // Path to script hooks
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: "USD"
  }
}
