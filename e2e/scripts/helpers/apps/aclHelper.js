import { abi as aclAbi } from '@aragon/os/abi/ACL.json'
import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import { createVote, voteForAction } from './votingHelper'
import { init as dePoolOracleInit } from './dePoolOracleHelper'

let web3
let context
let aclContract
let logger

function init(c) {
  if (!context) {
    context = c
    web3 = context.web3
    dePoolOracleInit(context)
    logger = context.logger
    aclContract = new web3.eth.Contract(aclAbi, getProxyAddress())
  }
}

function getProxyAddress() {
  return context.apps.aclApp.proxyAddress
}

async function hasInitialized() {
  return await aclContract.methods.hasInitialized().call()
}

// TODO delete?
async function setPermissions(members, role, app_address, holder, holders) {
  for (let i = 0; i < members.length; i++) {
    for (let j = 0; j < role.length; j++) {
      const callData1 = encodeCallScript([
        {
          to: getProxyAddress(),
          calldata: await aclContract.methods.grantPermission(members[i], app_address, role[j]).encodeABI()
        }
      ])
      const voteId = await createVote(callData1, holder, 'Add permission ' + role[j])
      await voteForAction(voteId, holders, 'Add permission ' + role[j])
    }
  }
}
//TODO delete?
async function hasPermissions(members, address, roles) {
  let state
  for (let i = 0; i < members.length; i++) {
    for (let j = 0; j < roles.length; j++) {
      state = await aclContract.methods.hasPermission(members[i], address, roles[j]).call()
      if (!state) {
        logger.error('Permissions {0} for {1} member has not accessed'.format(roles[j], members[i]))
        return state
      }
    }
  }
  return state
}

export { init, aclContract, getProxyAddress, setPermissions, hasInitialized, hasPermissions }
