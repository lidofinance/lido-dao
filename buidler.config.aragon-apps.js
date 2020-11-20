const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@aragon/buidler-aragon')

const baseConfig = require('./buidler.config.js')
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

if (process.env.STD_APPS_DEPLOY) {
  console.log(`Buidler config:`, module.exports)
}
