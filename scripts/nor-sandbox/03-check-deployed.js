const { network, ethers } = require('hardhat')
const { Contract, utils } = require('ethers')
const chalk = require('chalk')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr, cy } = require('../helpers/log')
const {
  readStateAppAddress,
  _checkEq,
  _pause,
  MANAGE_SIGNING_KEYS,
  MANAGE_NODE_OPERATOR_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  STAKING_ROUTER_ROLE,
  STAKING_MODULE_MANAGE_ROLE,
  REQUEST_BURN_SHARES_ROLE,
  easyTrackABI,
  easyTrackEvmExecutorABI,
  easyTrackFactoryABI,
} = require('../simpledvt/helpers')
const { readNetworkState, assertRequiredNetworkState } = require('../helpers/persisted-network-state')
const { hash: namehash } = require('eth-ens-namehash')
const { resolveLatestVersion } = require('../components/apm')
const { APP_NAMES, APP_ARTIFACTS } = require('../constants')
const { ETH, toBN, genKeys, ethToStr } = require('../../test/helpers/utils')
const { EvmSnapshot } = require('../../test/helpers/blockchain')

const APP_TRG = process.env.APP_TRG || 'sandbox'

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

async function checkSimpleDVT({ web3, artifacts, trgAppName = APP_TRG }) {
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
  const { ipfsCid } = state[`app:${trgAppName}`].aragonApp
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
    votingAddress,
    'Voting is permission manager: MANAGE_SIGNING_KEYS'
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
    await acl.hasPermission(votingAddress, trgProxyAddress, MANAGE_SIGNING_KEYS),
    true,
    'Voting has permission: MANAGE_SIGNING_KEYS'
  )
  _checkEq(
    await acl.hasPermission(votingAddress, trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE),
    true,
    'Voting has permission: MANAGE_NODE_OPERATOR_ROLE'
  )
  _checkEq(
    await acl.hasPermission(votingAddress, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    true,
    'Voting has permission: SET_NODE_OPERATOR_LIMIT_ROLE'
  )
  _checkEq(
    await acl.hasPermission(easyTrackEVMScriptExecutor, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE),
    true,
    'EasyTrackEVMScriptExecutor has permission: SET_NODE_OPERATOR_LIMIT_ROLE'
  )

  _checkEq(
    await acl.hasPermission(srAddress, trgProxyAddress, STAKING_ROUTER_ROLE),
    true,
    'StakingRouter has permission: STAKING_ROUTER_ROLE'
  )

  log.splitter()

  _checkEq(await stakingRouter.getStakingModulesCount(), 3, 'StakingRouter: modules count = 3')
  const srModuleId = 3

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
    await _pause('Ready for simulation')
    log.splitter()

    log(gr(`Simulating adding keys and deposit!`))
    const strangers = await web3.eth.getAccounts()

    const abiCoder = new utils.AbiCoder()

    log('Creating snapshot...')
    const snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()

    try {
      const lido = await artifacts.require('Lido').at(lidoAddress)

      await ethers.getImpersonatedSigner(easyTrackAddress)
      await ethers.getImpersonatedSigner(votingAddress)
      const easyTrackSigner = await ethers.getSigner(easyTrackAddress)
      // const votingSigner = await ethers.getSigner(votingAddress)
      const evmExecutor = new Contract(easyTrackEVMScriptExecutor, easyTrackEvmExecutorABI, easyTrackSigner)

      const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
      const ADDRESS_2 = '0x0000000000000000000000000000000000000002'

      const depositsCount = 2000
      const op1keysAmount = 100
      const op2keysAmount = 50
      const keysAmount = op1keysAmount + op2keysAmount
      if ((await trgApp.getNodeOperatorsCount()) < 1) {
        // prepare node operators

        // add 2 NO (on behalf voting)
        await trgApp.addNodeOperator('op 1', ADDRESS_1, { from: votingAddress, gasPrice: 0 })
        await trgApp.addNodeOperator('op 2', ADDRESS_2, { from: votingAddress, gasPrice: 0 })

        _checkEq(await trgApp.getNodeOperatorsCount(), 2, `Module operators count = 2`)

        // add keys to module for op1 (on behalf op1 reward addr)
        log(`Adding ${op1keysAmount} keys for op1 (on behalf op1 reward addr)...`)
        await ethers.getImpersonatedSigner(ADDRESS_1)
        let keys = genKeys(op1keysAmount)
        await trgApp.addSigningKeys(0, op1keysAmount, keys.pubkeys, keys.sigkeys, { from: ADDRESS_1, gasPrice: 0 })

        // add keys to module for op2 (on behalf op2 reward addr)
        log(`Adding ${op2keysAmount} keys for op1 (on behalf op2 reward addr)...`)
        await ethers.getImpersonatedSigner(ADDRESS_2)
        keys = genKeys(op2keysAmount)
        await trgApp.addSigningKeys(1, op2keysAmount, keys.pubkeys, keys.sigkeys, { from: ADDRESS_2, gasPrice: 0 })

        log('Checking operators initial state...')
        let opInfo = await trgApp.getNodeOperator(0, true)
        _checkEq(opInfo.totalAddedValidators, op1keysAmount, `NO 1 totalAddedValidators = ${op1keysAmount}`)
        opInfo = await trgApp.getNodeOperator(1, true)
        _checkEq(opInfo.totalAddedValidators, op2keysAmount, `NO 2 totalAddedValidators = ${op2keysAmount}`)

        // increase keys limit via ET
        // equivalent of:
        // await trgApp.setNodeOperatorStakingLimit(0, op1keysAmount, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })
        // await trgApp.setNodeOperatorStakingLimit(1, op2keysAmount, { from: easyTrackEVMScriptExecutor, gasPrice: 0 })

        log(`Increasing op1 vetted keys limit via ET ${cy('IncreaseNodeOperatorStakingLimit')} factory...`)
        let callData = abiCoder.encode(['uint256', 'uint256'], [0, op1keysAmount])
        let evmScript = await factories.IncreaseNodeOperatorStakingLimit.createEVMScript(ADDRESS_1, callData)
        await evmExecutor.executeEVMScript(evmScript)
        log(`Increasing op1 vetted keys limit via ET ${cy('IncreaseNodeOperatorStakingLimit')} factory...`)
        callData = abiCoder.encode(['uint256', 'uint256'], [1, op2keysAmount])
        evmScript = await factories.IncreaseNodeOperatorStakingLimit.createEVMScript(ADDRESS_2, callData)
        await evmExecutor.executeEVMScript(evmScript)
      }

      log(`Checking module state in StakingRouter...`)
      let summary = await trgApp.getStakingModuleSummary()
      _checkEq(summary.totalDepositedValidators, 0, `Module totalDepositedValidators = 0`)
      _checkEq(summary.depositableValidatorsCount, keysAmount, `Module depositableValidatorsCount = ${keysAmount}`)

      const wqAddress = readStateAppAddress(state, 'withdrawalQueueERC721')
      const withdrwalQueue = await artifacts.require('WithdrawalQueueERC721').at(wqAddress)

      const unfinalizedStETH = await withdrwalQueue.unfinalizedStETH()
      const ethToDeposit = toBN(ETH(32 * depositsCount))
      let depositableEther = await lido.getDepositableEther()

      log(`Depositable ETH ${yl(ethToStr(depositableEther))} ETH`)
      log(`Need (${yl(ethToStr(ethToDeposit))} ETH to deposit ${yl(depositsCount)} keys`)

      // // simulate deposits by transfering ethers to Lido contract
      if (depositableEther.lt(ethToDeposit)) {
        log(`Simulating additional ETH submitting...`)
        const bufferedEther = await lido.getBufferedEther()
        const wqDebt = unfinalizedStETH.gt(bufferedEther) ? unfinalizedStETH.sub(bufferedEther) : toBN(0)
        let ethToSubmit = ethToDeposit.add(wqDebt)

        let i = 0
        const minBalance = toBN(ETH(1))
        while (!ethToSubmit.isZero() && i < strangers.length) {
          const balance = toBN(await web3.eth.getBalance(strangers[i]))
          if (balance.gt(minBalance)) {
            let ethToTransfer = balance.sub(minBalance)
            if (ethToTransfer.gt(ethToSubmit)) {
              ethToTransfer = ethToSubmit
            }
            log(`- ${ethToStr(ethToTransfer)} ETH from stranger ${strangers[i]}...`)
            await web3.eth.sendTransaction({ value: ethToTransfer, to: lido.address, from: strangers[i], gasPrice: 0 })
            ethToSubmit = ethToSubmit.sub(ethToTransfer)
          }
          ++i
        }
      }
      depositableEther = await lido.getDepositableEther()

      _checkEq(
        depositableEther.gte(ethToDeposit),
        true,
        `Enough depositable ${yl(ethToStr(depositableEther))} ETH to` +
          ` deposit ${yl(depositsCount)} keys (${yl(ethToStr(ethToDeposit))} ETH)`
      )

      // get max deposits count from SR (according targetShare value)
      //
      // NOR module id = 1
      // SimpleDVT module id = 2
      // Sandbox module id = 3
      const trgModuleId = 3 // sr module id

      const [maxDepositsCount1, maxDepositsCount2, maxDepositsCount3] = (
        await Promise.all([
          stakingRouter.getStakingModuleMaxDepositsCount(1, ethToDeposit),
          stakingRouter.getStakingModuleMaxDepositsCount(2, ethToDeposit),
          stakingRouter.getStakingModuleMaxDepositsCount(3, ethToDeposit),
        ])
      ).map((x) => x.toNumber())
      log(`Max deposits count for NOR module:`, maxDepositsCount1)
      log(`Max deposits count for SimpleDVT module:`, maxDepositsCount2)
      log(`Max deposits count for Sandbox module:`, maxDepositsCount3)

      log(`Depositing ${depositsCount} keys (on behalf DSM)..`)
      await ethers.getImpersonatedSigner(dsmAddress)
      await lido.deposit(depositsCount, trgModuleId, '0x', {
        from: dsmAddress,
        gasPrice: 0,
      })
      await ethers.provider.send('evm_increaseTime', [600])
      await ethers.provider.send('evm_mine')

      log(`Checking module new state in StakingRouter...`)
      summary = await trgApp.getStakingModuleSummary()
      _checkEq(
        summary.totalDepositedValidators,
        maxDepositsCount3,
        `Summary totalDepositedValidators = ${maxDepositsCount3}`
      )
      _checkEq(
        summary.depositableValidatorsCount,
        keysAmount - maxDepositsCount3,
        `Summary depositableValidatorsCount = ${keysAmount - maxDepositsCount3}`
      )

      // as only 2 ops in module and each has 0 deposited keys before
      const depositedKeysPerOp = maxDepositsCount3 / 2
      const op1 = await trgApp.getNodeOperator(0, false)
      _checkEq(op1.totalAddedValidators, op1keysAmount, `op1 state: totalAddedValidators = 100`)
      _checkEq(
        op1.totalDepositedValidators,
        depositedKeysPerOp,
        `op1 state: totalDepositedValidators = ${depositedKeysPerOp}`
      )

      const op2 = await trgApp.getNodeOperator(1, false)
      _checkEq(op2.totalAddedValidators, op2keysAmount, `op2 state: totalAddedValidators = 50`)
      _checkEq(
        op2.totalDepositedValidators,
        depositedKeysPerOp,
        `op2 state: totalDepositedValidators = ${depositedKeysPerOp}`
      )
    } finally {
      log('Reverting snapshot...')
      await snapshot.rollback()
    }
  }
}

module.exports = runOrWrapScript(checkSimpleDVT, module)
