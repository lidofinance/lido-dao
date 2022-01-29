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
    appServePort: 3011,
    clientServePort: 3000,
    appSrcPath: 'apps/lidooracle/app/',
    appBuildOutputPath: 'apps/lidooracle/dist/',
    appName: 'lidooracle',
    hooks // Path to script hooks
  }
}
