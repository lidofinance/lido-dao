const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const { getContract } = require('./abi')
const { getSenderAddr, addressEqual, trim0x } = require('./utils')
const { createVote } = require('./dao')

const NodeOperatorsRegistry = getContract('NodeOperatorsRegistry')

async function getRegistry(web3, address) {
  NodeOperatorsRegistry.setProvider(web3.currentProvider)
  return await NodeOperatorsRegistry.at(address)
}

async function listOperators(registry) {
  const count = +(await registry.getNodeOperatorsCount())
  const opPromises = Array.from({ length: count }, (_, i) => registry.getNodeOperator(i, true))
  const ops = await Promise.all(opPromises)
  return ops.map(normalizeNodeOperator)
}

async function addSigningKeys(registry, pubkeys, signatures, opts) {
  const totalKeys = pubkeys.length
  if (totalKeys === 0) {
    throw new Error(`you should provide at least one public key`)
  }

  if (signatures.length !== totalKeys) {
    throw new Error(`the number of provided signatures must match the number of provided pubkeys`)
  }

  const pubkeysData = pubkeys.map(trim0x).join('')
  const signaturesData = signatures.map(trim0x).join('')

  if (pubkeysData.length !== 48 * 2 * totalKeys) {
    throw new Error(`each pubkey must be 48 bytes long`)
  }

  if (signaturesData.length !== 96 * 2 * totalKeys) {
    throw new Error(`each signature must be 96 bytes long`)
  }

  const fromAddr = await getSenderAddr(registry, opts)
  const ops = await listOperators(registry)

  const opIndex = ops.findIndex((op) => addressEqual(fromAddr, op.rewardAddress))
  if (opIndex === -1) {
    // TODO: support DAO voting
    throw new Error(`only node operators are allowed to add signing keys`)
  }

  return await registry.addSigningKeysOperatorBH(opIndex, totalKeys, '0x' + pubkeysData, '0x' + signaturesData, opts)
}

async function setStakingLimit(registry, voting, tokenManager, operatorId, newLimit, txOpts) {
  const evmScript = encodeCallScript([
    {
      to: registry.address,
      calldata: await registry.contract.methods.setNodeOperatorStakingLimit(operatorId, newLimit).encodeABI()
    }
  ])
  const op = normalizeNodeOperator(await registry.getNodeOperator(operatorId, true))
  const voteDesc =
    `Change staking limit of operator '${op.name}' (id ${operatorId}, reward ` +
    `address ${op.rewardAddress}) from ${op.stakingLimit} to ${newLimit}`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

function normalizeNodeOperator(op) {
  return {
    name: op.name,
    active: op.active,
    rewardAddress: op.rewardAddress,
    stakingLimit: +op.stakingLimit,
    stoppedValidators: +op.stoppedValidators,
    totalSigningKeys: +op.totalSigningKeys,
    usedSigningKeys: +op.usedSigningKeys
  }
}

module.exports = {
  NodeOperatorsRegistry,
  getRegistry,
  listOperators,
  addSigningKeys,
  setStakingLimit
}
