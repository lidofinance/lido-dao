const fs = require('fs').promises
const path = require('path')

const artifactsPath = path.resolve(__dirname, '..', 'artifacts')
const contractsPath = path.resolve(__dirname, '..', 'contracts')
const abisPath = path.resolve(__dirname, '..', 'lib', 'abi')

async function exportAbi() {
  const allArtifactPaths = await iterToArray(getFiles(artifactsPath))
  const skipNames = /(Mock|test_helpers|Imports|deposit_contract|Pausable|.dbg.json|build-info|interfaces|oracle\/Algorithm.sol|oracle\/BitOps.sol|template\/LidoTemplate.sol)/

  const artifactPaths = allArtifactPaths
    .map((f) => path.relative(artifactsPath, f))
    .filter((relpath) => !skipNames.test(relpath))

  const lidoArtifactPaths = artifactPaths.filter(p => p.substr(0, 10) === 'contracts/')

  const aragonAtrifactPaths = [
    '@aragon/apps-finance/contracts/Finance.sol/Finance.json',
    '@aragon/apps-token-manager/contracts/TokenManager.sol/TokenManager.json',
    '@aragon/apps-vault/contracts/Vault.sol/Vault.json',
    '@aragon/apps-voting/contracts/Voting.sol/Voting.json'
  ]

  await extractABIs(lidoArtifactPaths.concat(aragonAtrifactPaths), abisPath)
}

async function extractABIs(artifactPaths, abisPath) {
  if (await exists(abisPath)) {
    await fs.rmdir(abisPath, { recursive: true })
  }

  await fs.mkdir(abisPath, { recursive: true })

  for (const artifactPath of artifactPaths) {
    const artifactContent = await fs.readFile(path.join(artifactsPath, artifactPath))
    const artifact = JSON.parse(artifactContent)
    if (artifact.abi && artifact.abi.length) {
      console.log(`Extracting ABI for ${artifact.contractName}...`)
      const abiData = JSON.stringify(artifact.abi)
      await fs.writeFile(path.join(abisPath, `${artifact.contractName}.json`), abiData)
    }
  }
}

async function* getFiles(dir) {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  for (const dirent of dirents) {
    const res = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      yield* getFiles(res)
    } else {
      yield res
    }
  }
}

async function iterToArray(iter) {
  const result = []
  for await (const value of iter) {
    result.push(value)
  }
  return result
}

async function exists(fileName) {
  try {
    await fs.access(fileName)
    return true
  } catch (err) {
    return false
  }
}

exportAbi()
  .then(() => console.log(`All done!`))
  .catch((err) => {
    console.error(err.stack)
    process.exit(10)
  })
