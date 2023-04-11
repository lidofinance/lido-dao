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
    appServePort: 3011,
    clientServePort: 3000,
    appSrcPath: 'apps/legacyoracle/app/',
    appBuildOutputPath: 'apps/legacyoracle/dist/',
    appName: 'legacyoracle',
    hooks, // Path to script hooks
  },
}
