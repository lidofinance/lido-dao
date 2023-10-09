const { network, ethers } = require('hardhat')
const { Contract, utils } = require('ethers')
const chalk = require('chalk')
const { assert } = require('chai')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr } = require('../helpers/log')
const {
  getDeployer,
  readStateAppAddress,
  MANAGE_SIGNING_KEYS,
  MANAGE_NODE_OPERATOR_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  STAKING_ROUTER_ROLE,
  STAKING_MODULE_MANAGE_ROLE,
  SIMPLE_DVT_IPFS_CID,
} = require('./helpers')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { hash: namehash } = require('eth-ens-namehash')
const { resolveLatestVersion } = require('../components/apm')
const { APP_NAMES, APP_ARTIFACTS } = require('../constants')
const { ETH, toBN, genKeys } = require('../../test/helpers/utils')
const { EvmSnapshot } = require('../../test/helpers/blockchain')

const APP_TRG = process.env.APP_TRG || 'simple-dvt'
const APP_IPFS_CID = process.env.APP_IPFS_CID || SIMPLE_DVT_IPFS_CID

const SIMULATE = !!process.env.SIMULATE

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmAddress',
  'lidoApmEnsName',
  'daoAddress',
  'lidoLocator',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
]

function _checkEq(a, b, descr = '') {
  assert.equal(a, b, descr)
  log.success(descr)
}

async function deployNORClone({ web3, artifacts, trgAppName = APP_TRG, ipfsCid = APP_IPFS_CID }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${trgAppName}`]))

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const lidoLocatorAddress = readStateAppAddress(state, `lidoLocator`)
  log(`Lido Locator:`, yl(lidoLocatorAddress))
  log.splitter()

  const srcAppName = APP_NAMES.NODE_OPERATORS_REGISTRY
  const srcAppFullName = `${srcAppName}.${state.lidoApmEnsName}`
  const srcAppId = namehash(srcAppFullName)
  const { contractAddress: srcContractAddress } = await resolveLatestVersion(srcAppId, ens, artifacts)

  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)

  console.log({ trgAppId, ens, artifacts })
  const { semanticVersion, contractAddress, contentURI } = await resolveLatestVersion(trgAppId, ens, artifacts)

  _checkEq(contractAddress, srcContractAddress, 'App APM repo last version: implementation is the same to NOR')
  _checkEq(
    contentURI,
    '0x' + Buffer.from(`ipfs:${ipfsCid}`, 'utf8').toString('hex'),
    'App APM repo last version: IPFS CIT correct'
  )
  _checkEq(semanticVersion.map((x) => x.toNumber()).join(''), '100', 'App APM repo last version: app version = 1.0.0')

  const trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`)
  const trgAppArtifact = APP_ARTIFACTS[srcAppName] // get source app artifact
  const trgApp = await artifacts.require(trgAppArtifact).at(trgProxyAddress)
  const {
    moduleName,
    moduleType,
    targetShare,
    moduleFee,
    treasuryFee,
    penaltyDelay,
    easyTrackAddress,
    easyTrackEVMScriptExecutor,
    easyTrackFactories = {},
  } = state[`app:${trgAppName}`].stakingRouterModuleParams

  _checkEq(await trgApp.appId(), trgAppId, 'App Contract: AppID correct')
  _checkEq(await trgApp.kernel(), state.daoAddress, 'App Contract: kernel address correct')
  _checkEq(await trgApp.hasInitialized(), true, 'App Contract: initialized')
  _checkEq(await trgApp.getLocator(), lidoLocatorAddress, 'App Contract: Locator address correct')

  log.splitter()
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const agentAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_AGENT}`)
  const votingAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_VOTING}`)
  const lidoAddress = readStateAppAddress(state, `app:${APP_NAMES.LIDO}`)
  const srAddress = readStateAppAddress(state, 'stakingRouter')
  const dsmAddress = readStateAppAddress(state, 'depositSecurityModule')
  const stakingRouter = await artifacts.require('StakingRouter').at(srAddress)

  _checkEq(
    await stakingRouter.hasRole(STAKING_MODULE_MANAGE_ROLE, agentAddress),
    true,
    'Agent has role: STAKING_MODULE_MANAGE_ROLE'
  )

  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, MANAGE_SIGNING_KEYS),
    easyTrackEVMScriptExecutor,
    'EasyTrackEVMScriptExecutor is permission manager: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
    votingAddress,
    'Voting is permission manager: MANAGE_NODE_OPERATOR_ROLE'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    votingAddress,
    'Voting is permission manager: SET_NODE_OPERATOR_LIMIT_ROLE'
  )
  _checkEq(
    await acl.getPermissionManager(trgProxyAddress, STAKING_ROUTER_ROLE),
    votingAddress,
    'Voting is permission manager: STAKING_ROUTER_ROLE'
  )

  _checkEq(
    await acl.hasPermission(easyTrackEVMScriptExecutor, trgProxyAddress, MANAGE_SIGNING_KEYS),
    true,
    'EasyTrackEVMScriptExecutor has permission: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.hasPermission(easyTrackEVMScriptExecutor, trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
    true,
    'EasyTrackEVMScriptExecutor has permission: MANAGE_NODE_OPERATOR_ROLE'
  )
  _checkEq(
    await acl.hasPermission(easyTrackEVMScriptExecutor, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    true,
    'EasyTrackEVMScriptExecutor has permission: SET_NODE_OPERATOR_LIMIT_ROLE'
  )

  _checkEq(
    await acl.hasPermission(easyTrackEVMScriptExecutor, trgProxyAddress, STAKING_ROUTER_ROLE),
    true,
    'EasyTrackEVMScriptExecutor has permission: STAKING_ROUTER_ROLE'
  )

  _checkEq(
    await acl.hasPermission(srAddress, trgProxyAddress, STAKING_ROUTER_ROLE),
    true,
    'StakingRouter has permission: STAKING_ROUTER_ROLE'
  )

  if (state.easytrackAddress) {
    _checkEq(
      await acl.hasPermission(state.easytrackAddress, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
      true,
      'Easytrack has permission: SET_NODE_OPERATOR_LIMIT_ROLE'
    )
  } else {
    log(yl('[-]'), 'No Easytrack address set - skip!')
  }

  log.splitter()

  _checkEq(await stakingRouter.getStakingModulesCount(), 2, 'StakingRouter: modules count = 2')
  const srModuleId = 2
  _checkEq(
    await stakingRouter.hasStakingModule(srModuleId),
    true,
    `StakingRouter: expected moduleId = ${srModuleId} exists`
  )

  const srModule = await stakingRouter.getStakingModule(srModuleId)
  _checkEq(srModule.name, moduleName, `StakingRouter module: name = ${trgAppName}`)
  _checkEq(srModule.stakingModuleAddress, trgProxyAddress, `StakingRouter module: address correct`)
  _checkEq(srModule.treasuryFee, treasuryFee, `StakingRouter module: treasuryFee = ${treasuryFee}`)
  _checkEq(srModule.stakingModuleFee, moduleFee, `StakingRouter module: moduleFee = ${moduleFee}`)
  _checkEq(srModule.targetShare, targetShare, `StakingRouter module: targetShare = ${targetShare}`)

  log.splitter()

  _checkEq(await trgApp.getStuckPenaltyDelay(), penaltyDelay, `App params: penalty delay = ${penaltyDelay}`)
  _checkEq(
    await trgApp.getType(),
    '0x' + Buffer.from(moduleType).toString('hex').padEnd(64, '0'),
    `App params: module type = ${moduleType}`
  )

  _checkEq(await trgApp.getNodeOperatorsCount(), 0, `App initial values: no any operators (count = 0)`)
  _checkEq(await trgApp.getActiveNodeOperatorsCount(), 0, `App initial values: no active operators (count = 0)`)
  _checkEq(await trgApp.getNonce(), 0, `App initial values: nonce (keysOpIndex) = 0`)

  const { totalExitedValidators, totalDepositedValidators, depositableValidatorsCount } =
    await trgApp.getStakingModuleSummary()
  _checkEq(totalExitedValidators, 0, `App initial values: totalExitedValidators = 0`)
  _checkEq(totalDepositedValidators, 0, `App initial values: totalDepositedValidators = 0`)
  _checkEq(depositableValidatorsCount, 0, `App initial values: depositableValidatorsCount = 0`)

  log.splitter()

  if (SIMULATE) {
    log(gr(`Simulating adding keys and deposit!`))
    const stranger = await getDeployer(web3)

    const abiCoder = new utils.AbiCoder()

    log('Creating snapshot...')
    const snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()

    try {
      const lido = await artifacts.require('Lido').at(lidoAddress)

      const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
      const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
      const MANAGER_1 = '0x0000000000000000000000000000000000000011'
      const MANAGER_2 = '0x0000000000000000000000000000000000000012'

      // create voting on behalf of dao agent
      await ethers.getImpersonatedSigner(agentAddress)
      await ethers.getImpersonatedSigner(votingAddress)
      await ethers.getImpersonatedSigner(dsmAddress)
      await ethers.getImpersonatedSigner(easyTrackEVMScriptExecutor)
      await ethers.getImpersonatedSigner(ADDRESS_1)
      await ethers.getImpersonatedSigner(ADDRESS_2)

      const depositsCount = 100
      const op1keysAmount = 100
      const op2keysAmount = 50
      const keysAmount = op1keysAmount + op2keysAmount
      if ((await trgApp.getNodeOperatorsCount()) < 1) {
        // prepare node operators

        // const factoryABI = [
        //   {
        //     inputs: [
        //       { internalType: 'address', name: '_creator', type: 'address' },
        //       { internalType: 'bytes', name: '_evmScriptCallData', type: 'bytes' },
        //     ],
        //     name: 'createEVMScript',
        //     outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
        //     stateMutability: 'view',
        //     type: 'function',
        //   },
        //   {
        //     inputs: [{ internalType: 'bytes', name: '_evmScriptCallData', type: 'bytes' }],
        //     name: 'decodeEVMScriptCallData',
        //     outputs: [
        //       { internalType: 'uint256', name: 'nodeOperatorsCount', type: 'uint256' },
        //       {
        //         components: [
        //           { internalType: 'string', name: 'name', type: 'string' },
        //           { internalType: 'address', name: 'rewardAddress', type: 'address' },
        //           { internalType: 'address', name: 'managerAddress', type: 'address' },
        //         ],
        //         internalType: 'struct AddNodeOperators.AddNodeOperatorInput[]',
        //         name: 'nodeOperators',
        //         type: 'tuple[]',
        //       },
        //     ],
        //     stateMutability: 'pure',
        //     type: 'function',
        //   },
        //   {
        //     inputs: [],
        //     name: 'nodeOperatorsRegistry',
        //     outputs: [{ internalType: 'contract INodeOperatorsRegistry', name: '', type: 'address' }],
        //     stateMutability: 'view',
        //     type: 'function',
        //   },
        //   {
        //     inputs: [],
        //     name: 'trustedCaller',
        //     outputs: [{ internalType: 'address', name: '', type: 'address' }],
        //     stateMutability: 'view',
        //     type: 'function',
        //   },
        // ]

        // let factoryAddress = easyTrackFactories.AddNodeOperators
        // let factory = new Contract(factoryAddress, factoryABI, ethers.provider)

        // _checkEq(await factory.nodeOperatorsRegistry(), trgProxyAddress, `Simulate init: operators count = 2`)

        // let callData = abiCoder.encode(
        //   ['uint256', 'tuple(string,address,address)[]'],
        //   [1, [['op 1', ADDRESS_1, MANAGER_1]]]
        // )
        // console.log(await factory.decodeEVMScriptCallData(callData))

        // let trustedCaller = await factory.trustedCaller()
        // await ethers.getImpersonatedSigner(trustedCaller)
        // let evmScript = await factory.createEVMScript(stranger, callData, { from: trustedCaller, gasPrice: 0 })
        // console.log(evmScript)

        await trgApp.addNodeOperator('op 1', ADDRESS_1, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
        await trgApp.addNodeOperator('op 2', ADDRESS_2, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })

        // add keys to module for op1
        let keys = genKeys(op1keysAmount)
        await trgApp.addSigningKeys(0, op1keysAmount, keys.pubkeys, keys.sigkeys, { from: ADDRESS_1, gasPrice: 0 })
        // add keys to module for op2
        keys = genKeys(op2keysAmount)
        await trgApp.addSigningKeys(1, op2keysAmount, keys.pubkeys, keys.sigkeys, { from: ADDRESS_2, gasPrice: 0 })

        // increase keys limit
        await trgApp.setNodeOperatorStakingLimit(0, 100000, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
        await trgApp.setNodeOperatorStakingLimit(1, 100000, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
      }

      _checkEq(await trgApp.getNodeOperatorsCount(), 2, `Simulate init: operators count = 2`)
      let summary = await trgApp.getStakingModuleSummary()
      // console.log(summary)
      _checkEq(summary.totalDepositedValidators, 0, `Simulate init: totalDepositedValidators = 0`)
      _checkEq(
        summary.depositableValidatorsCount,
        keysAmount,
        `Simulate init: depositableValidatorsCount = ${keysAmount}`
      )

      const wqAddress = readStateAppAddress(state, 'withdrawalQueueERC721')
      const withdrwalQueue = await artifacts.require('WithdrawalQueueERC721').at(wqAddress)

      const unfinalizedStETH = await withdrwalQueue.unfinalizedStETH()
      const ethToDeposit = toBN(ETH(32 * depositsCount))
      let depositableEther = await lido.getDepositableEther()
      if (depositableEther.lt(ethToDeposit)) {
        const bufferedEther = await lido.getBufferedEther()
        const wqDebt = unfinalizedStETH.gt(bufferedEther) ? unfinalizedStETH.sub(bufferedEther) : toBN(0)
        const ethToSubmit = ethToDeposit.add(wqDebt)
        await web3.eth.sendTransaction({ value: ethToSubmit, to: lido.address, from: stranger, gasPrice: 0 })
      }
      depositableEther = await lido.getDepositableEther()

      _checkEq(
        depositableEther >= ethToDeposit,
        true,
        `Simulate init: enough depositable ether for ${depositsCount} keys`
      )
      log('Depositing...')
      const trgModuleId = 2 // sr module id
      await lido.deposit(depositsCount, trgModuleId, '0x', {
        from: dsmAddress,
        gasPrice: 0,
      })
      await ethers.provider.send('evm_increaseTime', [600])
      await ethers.provider.send('evm_mine')

      summary = await trgApp.getStakingModuleSummary()
      _checkEq(
        summary.totalDepositedValidators,
        op1keysAmount,
        `Simulate deposited: summary totalDepositedValidators = ${depositsCount}`
      )
      _checkEq(
        summary.depositableValidatorsCount,
        keysAmount - depositsCount,
        `Simulate deposited: summary depositableValidatorsCount = ${keysAmount - depositsCount}`
      )

      const depositedKeysPerOp = depositsCount / 2 // as only 2 ops in module and each has 0 deposited keys before
      const op1 = await trgApp.getNodeOperator(0, false)
      _checkEq(op1.totalAddedValidators, op1keysAmount, `Simulate op1 state: totalAddedValidators = 100`)
      _checkEq(
        op1.totalDepositedValidators,
        depositedKeysPerOp,
        `Simulate op1 state: totalDepositedValidators = ${depositedKeysPerOp}`
      )

      const op2 = await trgApp.getNodeOperator(1, false)
      _checkEq(op2.totalAddedValidators, op2keysAmount, `Simulate op2 state: totalAddedValidators = 50`)
      _checkEq(
        op2.totalDepositedValidators,
        depositedKeysPerOp,
        `Simulate op2 state: totalDepositedValidators = ${depositedKeysPerOp}`
      )
    } finally {
      log('Reverting snapshot...')
      await snapshot.rollback()
    }
  }
}

module.exports = runOrWrapScript(deployNORClone, module)
