const chalk = require('chalk')

const {log, logDeploy} = require('./log')

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

module.exports = {deploy, useOrDeploy}
