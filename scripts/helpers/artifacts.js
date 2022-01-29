const fs = require('fs')
const path = require('path')

const { readJSON } = require('./fs')

async function loadArtifact(artifactName, netName) {
  if (artifactName.startsWith('external:')) {
    let extArtifactsDir = path.resolve(__dirname, '..', 'external-artifacts', netName)
    if (!fs.existsSync(extArtifactsDir)) {
      // fallback to mainnet
      extArtifactsDir = path.resolve(__dirname, '..', 'external-artifacts', 'default')
    }
    const artifactPath = path.join(extArtifactsDir, artifactName.substring(9) + '.json')
    return await readJSON(artifactPath)
  } else {
    return await artifacts.readArtifact(artifactName)
  }
}

module.exports = { loadArtifact }
