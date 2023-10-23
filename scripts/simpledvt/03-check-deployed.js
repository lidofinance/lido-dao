const { network, ethers } = require('hardhat')
const { Contract, utils } = require('ethers')
const chalk = require('chalk')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr, cy, mg } = require('../helpers/log')
const {
  getDeployer,
  readStateAppAddress,
  _checkEq,
  _pause,
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
  'lidoLocator',
  `app:${APP_NAMES.ARAGON_AGENT}`,
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
]

async function checkSimpleDVT({ web3, artifacts, trgAppName = APP_TRG, ipfsCid = APP_IPFS_CID }) {
  const netId = await web3.eth.net.getId()

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${trgAppName}`]))

  const kernelAddress = state.daoAddress || readStateAppAddress(state, `aragon-kernel`)
  if (!kernelAddress) {
    throw new Error(`No Aragon kernel (DAO address) found!`)
  }

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
    easyTrackFactories = {},
  } = state[`app:${trgAppName}`].stakingRouterModuleParams

  _checkEq(await trgApp.appId(), trgAppId, 'App Contract: AppID correct')
  _checkEq(await trgApp.kernel(), kernelAddress, 'App Contract: kernel address correct')
  _checkEq(await trgApp.hasInitialized(), true, 'App Contract: initialized')
  _checkEq(await trgApp.getLocator(), lidoLocatorAddress, 'App Contract: Locator address correct')

  log.splitter()
  const kernel = await artifacts.require('Kernel').at(kernelAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const agentAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_AGENT}`)
  const votingAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_VOTING}`)
  const lidoAddress = readStateAppAddress(state, `app:${APP_NAMES.LIDO}`)
  const srAddress = readStateAppAddress(state, 'stakingRouter')
  const dsmAddress = readStateAppAddress(state, 'depositSecurityModule')
  const stakingRouter = await artifacts.require('StakingRouter').at(srAddress)
  const burnerAddress = readStateAppAddress(state, `burner`)
  const burner = await artifacts.require('Burner').at(burnerAddress)
  const easytrack = new Contract(easyTrackAddress, easyTrackABI).connect(ethers.provider)
  const easyTrackEVMScriptExecutor = await easytrack.evmScriptExecutor()

  _checkEq(
    await stakingRouter.hasRole(STAKING_MODULE_MANAGE_ROLE, agentAddress),
    true,
    'Agent has role: STAKING_MODULE_MANAGE_ROLE'
  )

  _checkEq(
    await burner.hasRole(REQUEST_BURN_SHARES_ROLE, trgProxyAddress),
    true,
    'App has role: REQUEST_BURN_SHARES_ROLE'
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

  // hardcode ET EVM script executor and ET factory ABIs to avoid adding external ABI files to repo

  const allFactories = await easytrack.getEVMScriptFactories()
  // console.log(allFactories)

  // create ET factories instances
  const factories = Object.entries(easyTrackFactories).reduce(
    (f, [n, a]) => ({ ...f, [n]: new Contract(a, easyTrackFactoryABI, ethers.provider) }),
    {}
  )

  for (const name of Object.keys(factories)) {
    // `EasyTrack Factory <${cy(f)}>`
    log(`ET factory <${cy(name)}>:`)
    _checkEq(allFactories.includes(factories[name].address), true, `- in global list`)
    _checkEq(await easytrack.isEVMScriptFactory(factories[name].address), true, `- isEVMScriptFactory`)
    _checkEq(await factories[name].nodeOperatorsRegistry(), trgProxyAddress, `- matches target App`)
  }

  log.splitter()

  if (SIMULATE) {
    await _pause(mg('>>> Enter Y to start simulation, interrupt process otherwise:'))
    log.splitter()

    log(gr(`Simulating adding keys and deposit!`))
    const stranger = await getDeployer(web3)

    const abiCoder = new utils.AbiCoder()

    log('Creating snapshot...')
    const snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()

    try {
      const lido = await artifacts.require('Lido').at(lidoAddress)

      await ethers.getImpersonatedSigner(easyTrackAddress)
      const easyTrackSigner = await ethers.getSigner(easyTrackAddress)
      const evmExecutor = new Contract(easyTrackEVMScriptExecutor, easyTrackEvmExecutorABI, easyTrackSigner)

      const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
      const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
      const MANAGER_1 = '0x0000000000000000000000000000000000000011'
      const MANAGER_2 = '0x0000000000000000000000000000000000000012'

      const depositsCount = 2000
      const op1keysAmount = 100
      const op2keysAmount = 50
      const keysAmount = op1keysAmount + op2keysAmount
      if ((await trgApp.getNodeOperatorsCount()) < 1) {
        // prepare node operators
        const trustedCaller = await factories.AddNodeOperators.trustedCaller()

        // add 2 NO via ET
        // equivalent of:
        // await trgApp.addNodeOperator('op 1', ADDRESS_1, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
        // await trgApp.addNodeOperator('op 2', ADDRESS_2, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })

        let callData = abiCoder.encode(
          // struct AddNodeOperatorInput {
          //     string name;
          //     address rewardAddress;
          //     address managerAddress;
          // }
          //
          // uint256 nodeOperatorsCount, AddNodeOperatorInput[] memory nodeOperators
          ['uint256', 'tuple(string,address,address)[]'],
          [
            0,
            [
              ['op 1', ADDRESS_1, MANAGER_1],
              ['op 2', ADDRESS_2, MANAGER_2],
            ],
          ]
        )
        let evmScript = await factories.AddNodeOperators.createEVMScript(trustedCaller, callData, {
          from: stranger,
          gasPrice: 0,
        })
        await evmExecutor.executeEVMScript(evmScript)
        _checkEq(await trgApp.getNodeOperatorsCount(), 2, `Simulate init: operators count = 2`)

        // add keys to module for op1 (on behalf op1 reward addr)
        await ethers.getImpersonatedSigner(ADDRESS_1)
        let keys = genKeys(op1keysAmount)
        await trgApp.addSigningKeys(0, op1keysAmount, keys.pubkeys, keys.sigkeys, { from: ADDRESS_1, gasPrice: 0 })

        // add keys to module for op2 (on behalf op2 manager)
        await ethers.getImpersonatedSigner(MANAGER_2)
        keys = genKeys(op2keysAmount)
        await trgApp.addSigningKeys(1, op2keysAmount, keys.pubkeys, keys.sigkeys, { from: MANAGER_2, gasPrice: 0 })

        let opInfo = await trgApp.getNodeOperator(0, true)
        _checkEq(
          opInfo.totalAddedValidators,
          op1keysAmount,
          `Simulate init: NO 1 totalAddedValidators = ${op1keysAmount}`
        )
        opInfo = await trgApp.getNodeOperator(1, true)
        _checkEq(
          opInfo.totalAddedValidators,
          op2keysAmount,
          `Simulate init: NO 2 totalAddedValidators = ${op2keysAmount}`
        )

        // increase keys limit via ET
        // equivalent of:
        // await trgApp.setNodeOperatorStakingLimit(0, op1keysAmount, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
        // await trgApp.setNodeOperatorStakingLimit(1, op2keysAmount, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })

        callData = abiCoder.encode(
          // struct VettedValidatorsLimitInput {
          //   uint256 nodeOperatorId;
          //   uint256 stakingLimit;
          // }
          //
          // VettedValidatorsLimitInput[]
          ['tuple(uint256,uint256)[]'],
          [
            [
              [0, op1keysAmount],
              [1, op2keysAmount],
            ],
          ]
        )
        evmScript = await factories.SetVettedValidatorsLimits.createEVMScript(trustedCaller, callData, {
          from: stranger,
          gasPrice: 0,
        })
        await evmExecutor.executeEVMScript(evmScript)
      }

      let summary = await trgApp.getStakingModuleSummary()
      _checkEq(summary.totalDepositedValidators, 0, `Simulate init: module totalDepositedValidators = 0`)
      _checkEq(
        summary.depositableValidatorsCount,
        keysAmount,
        `Simulate init: module depositableValidatorsCount = ${keysAmount}`
      )

      const wqAddress = readStateAppAddress(state, 'withdrawalQueueERC721')
      const withdrwalQueue = await artifacts.require('WithdrawalQueueERC721').at(wqAddress)

      const unfinalizedStETH = await withdrwalQueue.unfinalizedStETH()
      const ethToDeposit = toBN(ETH(32 * depositsCount))
      let depositableEther = await lido.getDepositableEther()

      // simulate deposits by transfering ethers to Lido contract
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

      // get max deposits count from SR (according targetShare value)
      //
      // NOR module id = 1
      // const maxDepositsCount1 = (await stakingRouter.getStakingModuleMaxDepositsCount(1, ethToDeposit)).toNumber()
      // SimpleDVT module id = 2
      const maxDepositsCount2 = (await stakingRouter.getStakingModuleMaxDepositsCount(2, ethToDeposit)).toNumber()

      log(`Depositing ${depositsCount} keys ..`)
      const trgModuleId = 2 // sr module id
      await ethers.getImpersonatedSigner(dsmAddress)
      await lido.deposit(depositsCount, trgModuleId, '0x', {
        from: dsmAddress,
        gasPrice: 0,
      })
      await ethers.provider.send('evm_increaseTime', [600])
      await ethers.provider.send('evm_mine')

      summary = await trgApp.getStakingModuleSummary()
      _checkEq(
        summary.totalDepositedValidators,
        maxDepositsCount2,
        `Simulate deposited: summary totalDepositedValidators = ${maxDepositsCount2}`
      )
      _checkEq(
        summary.depositableValidatorsCount,
        keysAmount - maxDepositsCount2,
        `Simulate deposited: summary depositableValidatorsCount = ${keysAmount - maxDepositsCount2}`
      )

      // as only 2 ops in module and each has 0 deposited keys before
      const depositedKeysPerOp = maxDepositsCount2 / 2
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

module.exports = runOrWrapScript(checkSimpleDVT, module)
