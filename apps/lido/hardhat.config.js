require('@aragon/buidler-aragon')

const baseConfig = require('../../hardhat.config.js')
const hooks = require('./scripts/buidler-hooks')

module.exports = {
  ...baseConfig,
  paths: {
    ...baseConfig.paths,
    root: '../..'
  },
  defaultNetwork: process.env.NETWORK_NAME || 'localhost',
  // Aragon plugin configuration
  aragon: {
    ...baseConfig.aragon,
    appServePort: 3010,
    clientServePort: 3000,
    appSrcPath: 'apps/lido/app/',
    appBuildOutputPath: 'apps/lido/dist/',
    appName: 'lido',
    hooks // Path to script hooks
  }
}
