const chalk = require('chalk')

const { log, logDeploy } = require('./log')

async function deploy(artifactName, artifacts, deploy) {
  const Artifact = artifacts.require(artifactName)
  return await logDeploy(artifactName, deploy ? deploy(Artifact) : Artifact.new())
}

async function useOrDeploy(artifactName, artifacts, address, deploy) {
  const Artifact = artifacts.require(artifactName)
  if (address) {
    log(`Using ${artifactName}: ${chalk.yellow(address)}`)
    return await Artifact.at(address)
  } else {
    return await logDeploy(artifactName, deploy ? deploy(Artifact) : Artifact.new())
  }
}

function withArgs(...args) {
  return async (Artifact) => {
    const instance = await Artifact.new(...args)
    const lastArg = args[args.length - 1]
    // remove {from: ..., gas: ...}
    instance.constructorArgs = lastArg && typeof lastArg === 'object' && lastArg.constructor === Object ? args.slice(0, -1) : args
    return instance
  }
}

module.exports = { deploy, useOrDeploy, withArgs }
