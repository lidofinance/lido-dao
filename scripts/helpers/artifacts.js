const path = require('path')

const { readJSON } = require('./fs')

async function loadArtifact(artifactName, netName) {
  if (artifactName.startsWith('external:')) {
    const extArtifactsDir = path.resolve(__dirname, '..', 'external-artifacts', netName)
    const artifactPath = path.join(extArtifactsDir, artifactName.substring(9) + '.json')
    return await readJSON(artifactPath)
  } else {
    return await artifacts.readArtifact(artifactName)
  }
}

module.exports = { loadArtifact }
