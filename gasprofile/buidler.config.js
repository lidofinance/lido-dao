const baseConfig = require('../buidler.config.js')

module.exports = {
  ...baseConfig,
  paths: {
    sources: './test-contracts',
    cache: './cache'
  },
  mocha: {
    timeout: 100000
  }
}
