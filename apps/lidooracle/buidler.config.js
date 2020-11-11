const { usePlugin } = require('@nomiclabs/buidler/config')
const hooks = require('./scripts/buidler-hooks')

const baseConfig = require('../../buidler.config.js')

usePlugin('@aragon/buidler-aragon')

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
    appSrcPath: 'app/',
    appBuildOutputPath: 'dist/',
    appName: 'lidooracle',
    hooks // Path to script hooks
  }
}
