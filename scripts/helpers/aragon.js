const path = require('path')

const { readJSON } = require('./fs')

async function readAppName(appRoot, netName) {
  const { environments } = await readJSON(path.join(appRoot, 'arapp.json'))
  if (!environments) {
    return null
  }
  if (environments[netName]) {
    // NOTE: assuming that Aragon environment is named after the network
    return environments[netName].appName
  }
  return (environments.default || {}).appName || null
}

module.exports = { readAppName }
