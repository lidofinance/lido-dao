const chalk = require('chalk')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const {log, logTx} = require('../helpers/log')
const {isZeroAddress} = require('../helpers/address')

async function assignENSName({tldName = 'eth', labelName, owner, ens, assigneeAddress, assigneeDesc}) {
  log(`Assigning ENS name '${labelName}.${tldName}' to ${assigneeDesc} at ${assigneeAddress}...`)

  const tldHash = namehash(tldName)
  const labelHash = '0x' + keccak256(labelName)
  const nodeName = `${labelName}.${tldName}`
  const node = namehash(nodeName)

  log(`Node: ${chalk.yellow(nodeName)} (${node})`)
  log(`TLD: ${chalk.yellow(tldName)} (${tldHash})`)
  log(`Label: ${chalk.yellow(labelName)} (${labelHash})`)

  if ((await ens.owner(node)) === owner) {
    await logTx(
      `Transferring name ownership from owner ${owner} to ${assigneeAddress}`,
      ens.setOwner(node, assigneeAddress)
    )
  } else {
    try {
      await logTx(
        `Creating subdomain and assigning it to ${assigneeAddress}`,
        ens.setSubnodeOwner(tldHash, labelHash, assigneeAddress)
      )
    } catch (err) {
      log(
        `Error: could not set the owner of '${labelName}.${tldName}' on the given ENS instance`,
        `(${ens.address}). Make sure you have ownership rights over the subdomain.`
      )
      throw err
    }
  }

  return {tldHash, labelHash, nodeName, node}
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

module.exports = {assignENSName, getENSNodeOwner, resolveEnsAddress}
