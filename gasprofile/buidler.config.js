const path = require('path')

const baseConfig = require('../buidler.config.js')

module.exports = {
  ...baseConfig,
  defaultNetwork: 'localhost',
  paths: {
    ...baseConfig.paths,
    root: '..',
    cache: path.resolve(__dirname, 'cache')
  },
  mocha: {
    timeout: 100000
  }
}
