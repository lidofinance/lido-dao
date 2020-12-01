const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const { getContract } = require('./abi')
const { createVote } = require('./dao')

const LidoOracle = getContract('LidoOracle')

async function getOracle(web3, address) {
  LidoOracle.setProvider(web3.currentProvider)
  return await LidoOracle.at(address)
}

async function getBeaconSpec(oracle) {
  const spec = await oracle.beaconSpec()
  return normalizeBeaconSpec(spec)
}

async function proposeBeaconSpecChange(oracle, voting, tokenManager, newSpec, txOpts = {}) {
  const currentSpec = await getBeaconSpec(oracle)
  const updatedSpec = { ...currentSpec, ...newSpec }
  const calldata = await oracle.contract.methods
    .setBeaconSpec(updatedSpec.epochsPerFrame, updatedSpec.slotsPerEpoch, updatedSpec.secondsPerSlot, updatedSpec.genesisTime)
    .encodeABI()
  const evmScript = encodeCallScript([{ to: oracle.address, calldata }])
  const updatesDesc = Object.entries(newSpec)
    .map(([key, newValue]) => `${key} from ${currentSpec[key]} to ${newValue}`)
    .join(', ')
  const voteDesc = `Update Beacon chain spec: change ${updatesDesc}`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

function normalizeBeaconSpec(spec) {
  return {
    epochsPerFrame: +spec.epochsPerFrame,
    slotsPerEpoch: +spec.slotsPerEpoch,
    secondsPerSlot: +spec.secondsPerSlot,
    genesisTime: +spec.genesisTime
  }
}

module.exports = {
  LidoOracle,
  getOracle,
  getBeaconSpec,
  proposeBeaconSpecChange
}
