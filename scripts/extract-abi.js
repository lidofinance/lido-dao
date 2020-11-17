const fs = require('fs').promises
const path = require('path')

const artifactsPath = path.resolve(__dirname, '..', 'artifacts')
const contractsPath = path.resolve(__dirname, '..', 'contracts')
const abisPath = path.resolve(__dirname, '..', 'lib', 'abi')

async function exportAbi() {
  const solPaths = await iterToArray(getFiles(contractsPath))
  const skipNames = /(Mock|test_helpers|Imports|deposit_contract|Pausable)/

  const lidoNames = solPaths
    .filter((f) => {
      const relpath = path.relative(contractsPath, f)
      return /[.]sol$/.test(relpath) && !skipNames.test(relpath)
    })
    .map((f) => path.basename(f).replace(/[.]sol$/, ''))

  const aragonNames = ['Voting', 'TokenManager', 'Vault', 'Finance']
  await extractABIs(lidoNames.concat(aragonNames), abisPath)
}

async function extractABIs(artifactNames, abisPath) {
  if (await exists(abisPath)) {
    await fs.rmdir(abisPath, { recursive: true })
  }

  await fs.mkdir(abisPath, { recursive: true })

  for (const artifactName of artifactNames) {
    const jsonName = `${artifactName}.json`
    const artifactContent = await fs.readFile(path.join(artifactsPath, jsonName))
    const artifact = JSON.parse(artifactContent)
    if (artifact.abi && artifact.abi.length) {
      console.log(`Extracting ABI for ${artifactName}...`)
      const abiData = JSON.stringify(artifact.abi)
      await fs.writeFile(path.join(abisPath, jsonName), abiData)
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
