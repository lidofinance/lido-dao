const readline = require('readline')
const { assert } = require('chai')
const { log, rd, mg, yl } = require('../helpers/log')

const KERNEL_APP_BASES_NAMESPACE = '0xf1f3eb40f5bc1ad1344716ced8b8a0431d840b5783aea1fd01786bc26f35ac0f'

const MANAGE_SIGNING_KEYS = '0x75abc64490e17b40ea1e66691c3eb493647b24430b358bd87ec3e5127f1621ee'
const MANAGE_NODE_OPERATOR_ROLE = '0x78523850fdd761612f46e844cf5a16bda6b3151d6ae961fd7e8e7b92bfbca7f8'
const SET_NODE_OPERATOR_LIMIT_ROLE = '0x07b39e0faf2521001ae4e58cb9ffd3840a63e205d288dc9c93c3774f0d794754'
const STAKING_ROUTER_ROLE = '0xbb75b874360e0bfd87f964eadd8276d8efb7c942134fc329b513032d0803e0c6'
const STAKING_MODULE_MANAGE_ROLE = '0x3105bcbf19d4417b73ae0e58d508a65ecf75665e46c2622d8521732de6080c48'
const REQUEST_BURN_SHARES_ROLE = '0x4be29e0e4eb91f98f709d98803cba271592782e293b84a625e025cbb40197ba8'
const SIMPLE_DVT_IPFS_CID = 'QmaSSujHCGcnFuetAPGwVW5BegaMBvn5SCsgi3LSfvraSo'

const easyTrackABI = [
  {
    inputs: [],
    name: 'evmScriptExecutor',
    outputs: [{ internalType: 'contract IEVMScriptExecutor', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '_evmScriptFactory',
        type: 'address',
      },
      {
        internalType: 'bytes',
        name: '_permissions',
        type: 'bytes',
      },
    ],
    name: 'addEVMScriptFactory',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'evmScriptFactories',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'evmScriptFactoryPermissions',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getEVMScriptFactories',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },

  {
    inputs: [{ internalType: 'address', name: '_maybeEVMScriptFactory', type: 'address' }],
    name: 'isEVMScriptFactory',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
]

const easyTrackEvmExecutorABI = [
  {
    inputs: [{ internalType: 'bytes', name: '_evmScript', type: 'bytes' }],
    name: 'executeEVMScript',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

const easyTrackFactoryABI = [
  {
    inputs: [
      { internalType: 'address', name: '_creator', type: 'address' },
      { internalType: 'bytes', name: '_evmScriptCallData', type: 'bytes' },
    ],
    name: 'createEVMScript',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nodeOperatorsRegistry',
    outputs: [{ internalType: 'contract INodeOperatorsRegistry', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'trustedCaller',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
]

async function getDeployer(web3, defaultDeployer) {
  if (!defaultDeployer) {
    const [firstAccount] = await web3.eth.getAccounts()
    return firstAccount
  }
  return defaultDeployer
}

function readStateAppAddress(state, app = '') {
  const appState = state[app]
  // goerli/mainnet deployed.json formats compatibility
  return appState.proxyAddress || (appState.proxy && appState.proxy.address) || appState.address
}

function getSignature(instance, method) {
  const methodAbi = instance.contract._jsonInterface.find((i) => i.name === method)
  if (!methodAbi) {
    throw new Error(`Method ${method} not found in contract`)
  }
  return methodAbi.signature
}

function _checkEq(a, b, descr = '') {
  assert.equal(a, b, descr)
  log.success(descr)
}

function _checkLog(value, msg) {
  log(msg, yl(value))
  assert.isDefined(value, 'Value is missing')
}

function _checkEqLog(value, etalon, msg) {
  log(msg, yl(value))
  assert.equal(value, etalon, `Value not equal to: ${etalon}`)
}

function _pause(msg) {
  if (msg) log(rd(`!!! ${msg}`))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const query = mg('>>> Enter Y (or y) to continue, interrupt process otherwise:')

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close()
      if (ans !== 'y' && ans !== 'Y') {
        console.error(rd('Process aborted'))
        process.exit(1)
      }
      resolve()
    })
  )
}

module.exports = {
  readStateAppAddress,
  getDeployer,
  getSignature,
  _checkEq,
  _checkLog,
  _checkEqLog,
  _pause,
  KERNEL_APP_BASES_NAMESPACE,
  MANAGE_SIGNING_KEYS,
  MANAGE_NODE_OPERATOR_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  STAKING_ROUTER_ROLE,
  STAKING_MODULE_MANAGE_ROLE,
  REQUEST_BURN_SHARES_ROLE,
  SIMPLE_DVT_IPFS_CID,
  easyTrackABI,
  easyTrackEvmExecutorABI,
  easyTrackFactoryABI,
}
