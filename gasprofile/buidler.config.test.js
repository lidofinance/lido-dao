const baseConfig = require('../buidler.config.js')

module.exports = {
  ...baseConfig,
  defaultNetwork: 'localhost',
  paths: {
    sources: './test-contracts',
    cache: './cache/test'
  },
  mocha: {
    timeout: 100000
  }
}
