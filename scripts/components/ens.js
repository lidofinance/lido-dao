const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const { log, logTx } = require('../helpers/log')
const { isZeroAddress } = require('../helpers/address')

async function assignENSName({ parentName = 'eth', labelName, owner, ens, assigneeAddress, assigneeDesc }) {
  const assigneeFullDesc = assigneeDesc ? `${assigneeDesc} at ${assigneeAddress}` : assigneeAddress
  log(`Assigning ENS name '${labelName}.${parentName}' to ${assigneeFullDesc}...`)

  const parentNode = namehash(parentName)
  const labelHash = '0x' + keccak256(labelName)
  const nodeName = `${labelName}.${parentName}`
  const node = namehash(nodeName)

  log(`Node: ${chalk.yellow(nodeName)} (${node})`)
  log(`Parent node: ${chalk.yellow(parentName)} (${parentNode})`)
  log(`Label: ${chalk.yellow(labelName)} (${labelHash})`)

  let txResult

  if ((await ens.owner(node)) === owner) {
    txResult = await logTx(
      `Transferring name ownership from owner ${chalk.yellow(owner)} to ${chalk.yellow(assigneeAddress)}`,
      ens.setOwner(node, assigneeAddress, { from: owner })
    )
  } else {
    if ((await ens.owner(parentNode)) !== owner) {
      throw new Error(
        `the address ${owner} has no ownership righs over the target ` +
          `domain '${labelName}.${parentName}' or parent domain '${parentName}'`
      )
    }
    try {
      txResult = await logTx(
        `Creating the subdomain and assigning it to ${chalk.yellow(assigneeAddress)}`,
        ens.setSubnodeOwner(parentNode, labelHash, assigneeAddress, { from: owner })
      )
    } catch (err) {
      log(
        `Error: could not set the owner of '${labelName}.${parentName}' on the given ENS instance`,
        `(${ens.address}). Make sure you have ownership rights over the subdomain.`
      )
      throw err
    }
  }

  return { txResult, parentNode, labelHash, nodeName, node }
}

async function getENSNodeOwner(ens, node) {
  const ownerAddr = await ens.owner(node)
  return isZeroAddress(ownerAddr) ? null : ownerAddr
}

async function resolveEnsAddress(artifacts, ens, node) {
  const resolverAddr = await ens.resolver(node)
  if (isZeroAddress(resolverAddr)) {
    return null
  }
  const resolver = await artifacts.require('PublicResolver').at(resolverAddr)
  const addr = resolver.addr(node)
  return isZeroAddress(addr) ? null : addr
}

module.exports = { assignENSName, getENSNodeOwner, resolveEnsAddress }
