require('@aragon/buidler-aragon')

const baseConfig = require('./hardhat.config.js')
const aragonConfig = {}

// See scripts/deploy-aragon-std-apps.js
if (process.env.APP_FRONTEND_PATH) {
  aragonConfig.appSrcPath = process.env.APP_FRONTEND_PATH
  aragonConfig.appBuildOutputPath = process.env.APP_FRONTEND_DIST_PATH
}

module.exports = {
  ...baseConfig,
  aragon: {
    ...baseConfig.aragon,
    ...aragonConfig
  }
}
