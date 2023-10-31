require('@aragon/buidler-aragon')

const baseConfig = require('../../hardhat.config.js')
const hooks = require('./scripts/buidler-hooks.js')

module.exports = {
  ...baseConfig,
  paths: {
    ...baseConfig.paths,
    root: '../..',
  },
  defaultNetwork: process.env.NETWORK_NAME || 'localhost',
  // Aragon plugin configuration
  aragon: {
    ...baseConfig.aragon,
    appServePort: 3013,
    clientServePort: 3000,
    appSrcPath: 'apps/sandbox/app/',
    appBuildOutputPath: 'apps/sandbox/dist/',
    appName: 'sandbox',
    hooks, // Path to script hooks
  },
}
