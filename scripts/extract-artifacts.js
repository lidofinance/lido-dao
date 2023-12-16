const fs = require('fs')
const path = require('path')

const artifactsFileName = 'artifacts.json'
const artifactsPath = path.resolve(__dirname, '..', artifactsFileName)
const deployedFileName = 'deployed-mainnet.json'
const deployedPath = path.resolve(__dirname, '..', deployedFileName)

const stateKeysToIgnore = ['dummyEmptyContract', 'lidoTemplate']
const additionalArtifacts = [
  {
    "artifactPath": "artifacts/contracts/0.6.11/deposit_contract.sol/DepositContract.json",
    "sourcePath": "contracts/0.6.11/deposit_contract.sol",
    "name": "DepositContract",
    "address": "0x00000000219ab540356cBB839Cbe05303d7705Fa"
  }
]

function isValidContractInfo(info) {
    let isObject = function(a) {
      return (!!a) && (a.constructor === Object);
    }
    return isObject(info) && ('address' in info) && ('deployTx' in info) && ('contract' in info)
}

function getArtifactFromContractInfo(info) {
  let { dir, name, ext} = path.parse(info.contract)
  return {
    artifactPath: path.join('artifacts', info.contract, `${name}.json`),
    sourcePath: info.contract,
    name: name,
    address: info.address,
    txHash: info.deployTx,
  }
}

async function extractArtifacts() {
  const stateFileContent = fs.readFileSync(deployedPath, 'utf8')
  let state = null
  try {
    state = JSON.parse(stateFileContent)
  } catch (err) {
    throw new Error(`malformed network state file ${deployedPath}: ${err.message}`)
  }

  let artifacts = []
  for (const key in state) {
    if (stateKeysToIgnore.indexOf(key) > -1) continue

    const contractInfo = state[key]
    if (isValidContractInfo(contractInfo.proxy)) {
      artifacts.push(getArtifactFromContractInfo(contractInfo.proxy))
    }
    if (isValidContractInfo(contractInfo.implementation)) {
      artifacts.push(getArtifactFromContractInfo(contractInfo.implementation))
    }
    if (isValidContractInfo(contractInfo)) {
      artifacts.push(getArtifactFromContractInfo(contractInfo))
    }
  }
  artifacts.push(...additionalArtifacts)

  const artifactsJson = JSON.stringify(artifacts, null, '  ')
  fs.writeFileSync(artifactsPath, artifactsJson + '\n', 'utf8')
}

extractArtifacts()
  .then(() => console.log(`Contract artifacts extracted from ${deployedFileName} to ${artifactsFileName}.`))
  .catch((err) => {
    console.error(err.stack)
    process.exit(10)
  })
