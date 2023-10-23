const { network, ethers } = require('hardhat')
const chalk = require('chalk')
const { Contract } = require('ethers')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { EVMScriptDecoder, abiProviders } = require('evm-script-decoder')
const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, yl, gr, cy, mg } = require('../helpers/log')
// const { saveCallTxData } = require('../helpers/tx-data')
const { resolveLatestVersion } = require('../components/apm')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState2,
} = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')
const { hash: namehash } = require('eth-ens-namehash')
const { APP_NAMES, APP_ARTIFACTS } = require('../constants')
const {
  getDeployer,
  readStateAppAddress,
  getSignature,
  KERNEL_APP_BASES_NAMESPACE,
  MANAGE_SIGNING_KEYS,
  MANAGE_NODE_OPERATOR_ROLE,
  SET_NODE_OPERATOR_LIMIT_ROLE,
  STAKING_ROUTER_ROLE,
  STAKING_MODULE_MANAGE_ROLE,
  REQUEST_BURN_SHARES_ROLE,
  SIMPLE_DVT_IPFS_CID,
  easyTrackABI,
  _pause,
  _checkLog,
} = require('./helpers')
const { ETH, toBN } = require('../../test/helpers/utils')

const APP_TRG = process.env.APP_TRG || APP_NAMES.SIMPLE_DVT
const APP_IPFS_CID = process.env.APP_IPFS_CID || SIMPLE_DVT_IPFS_CID
const DEPLOYER = process.env.DEPLOYER || ''

const SIMULATE = !!process.env.SIMULATE
const VOTE_ID = process.env.VOTE_ID || ''

const REQUIRED_NET_STATE = [
  'ensAddress',
  'lidoApmAddress',
  'lidoApmEnsName',
  'lidoLocator',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`,
]

async function deploySimpleDVT({ web3, artifacts, trgAppName = APP_TRG, ipfsCid = APP_IPFS_CID }) {
  const netId = await web3.eth.net.getId()

  const srcAppName = APP_NAMES.NODE_OPERATORS_REGISTRY

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const deployer = await getDeployer(web3, DEPLOYER)
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${srcAppName}`, `app:${trgAppName}`]))

  const kernelAddress = state.daoAddress || readStateAppAddress(state, `aragon-kernel`)
  if (!kernelAddress) {
    throw new Error(`No Aragon kernel (DAO address) found!`)
  }

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)
  log.splitter()

  const srcAppFullName = `${srcAppName}.${state.lidoApmEnsName}`
  const srcAppId = namehash(srcAppFullName)
  const { semanticVersion, contractAddress } = await resolveLatestVersion(srcAppId, ens, artifacts)
  const srcVersion = semanticVersion.map((n) => n.toNumber())

  log(`Source App:`, yl(srcAppName))
  log(`Source App ENS:`, yl(srcAppFullName))
  log(`Source App ID:`, yl(srcAppId))
  log(`Source Contract implementation:`, yl(contractAddress))
  log(`Source App version:`, yl(srcVersion.join('.')))
  log.splitter()

  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)
  const trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`)
  const trgAppArtifact = APP_ARTIFACTS[srcAppName] // get source app artifact
  const trgApp = await artifacts.require(trgAppArtifact).at(trgProxyAddress)

  // set new version to 1.0.0
  const trgVersion = [1, 0, 0]
  const contentURI = '0x' + Buffer.from(`ipfs:${ipfsCid}`, 'utf8').toString('hex')

  log(`Target App:`, yl(trgAppName))
  log(`Target App ENS:`, yl(trgAppFullName))
  log(`Target App ID:`, yl(trgAppId))
  log(`Target App proxy`, yl(trgProxyAddress))
  log(`Target Contract implementation:`, yl(contractAddress))
  log(`Target Content IPFS CID:`, yl(ipfsCid))
  log(`Target Content URI:`, yl(contentURI))
  log(`Target App version:`, yl(trgVersion.join('.')))

  log.splitter()
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

  _checkLog(moduleName, `Target SR Module name`)
  _checkLog(moduleType, `Target SR Module type`)
  _checkLog(moduleFee, `Target SR Module fee`)
  _checkLog(targetShare, `Target SR Module targetShare`)
  _checkLog(treasuryFee, `Target SR Module treasuryFee`)
  _checkLog(penaltyDelay, `Target SR Module penaltyDelay`)

  if (!trgProxyAddress || (await web3.eth.getCode(trgProxyAddress)) === '0x') {
    log.error(`Target app proxy is not yet deployed!`)
    return
  }

  const trgRepoAddress = await resolveEnsAddress(artifacts, ens, trgAppId)

  if (trgRepoAddress && (await web3.eth.getCode(trgRepoAddress)) !== '0x') {
    log(`Target App APM repo:`, yl(trgRepoAddress))
    log.error(`Target app is already deployed!`)
    return
  }

  const lidoLocatorAddress = readStateAppAddress(state, `lidoLocator`)
  const votingAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_VOTING}`)
  const tokenManagerAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`)
  const srAddress = readStateAppAddress(state, 'stakingRouter')

  const kernel = await artifacts.require('Kernel').at(kernelAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const stakingRouter = await artifacts.require('StakingRouter').at(srAddress)
  const apmRegistry = await artifacts.require('APMRegistry').at(state.lidoApmAddress)

  const voteDesc = `Clone app '${srcAppName}' to '${trgAppName}'`
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const agentAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_AGENT}`)
  const agent = await artifacts.require('Agent').at(agentAddress)
  const daoTokenAddress = await tokenManager.token()
  const daoToken = await artifacts.require('MiniMeToken').at(daoTokenAddress)

  const burnerAddress = readStateAppAddress(state, `burner`)
  const burner = await artifacts.require('Burner').at(burnerAddress)

  log.splitter()
  log(`DAO Kernel`, yl(kernelAddress))
  log(`ACL`, yl(aclAddress))
  log(`Voting`, yl(votingAddress))
  log(`Token manager`, yl(tokenManagerAddress))
  log(`LDO token`, yl(daoTokenAddress))
  log(`Lido APM`, yl(state.lidoApmAddress))
  log(`Staking Router`, yl(srAddress))
  log(`Burner`, yl(burnerAddress))
  log(`Lido Locator:`, yl(lidoLocatorAddress))

  log.splitter()

  // use ethers.js Contract instance
  const easytrack = new Contract(easyTrackAddress, easyTrackABI).connect(ethers.provider)
  const easyTrackEVMScriptExecutor = await easytrack.evmScriptExecutor()

  log(`EasyTrack`, yl(easyTrackAddress))
  log(`EasyTrack EVM Script Executor`, yl(easyTrackEVMScriptExecutor))

  for (const f of Object.keys(easyTrackFactories)) {
    log(`EasyTrack Factory <${cy(f)}>`, yl(easyTrackFactories[f]))
  }

  log.splitter()
  await _pause()
  log.splitter()

  const evmScriptCalls = [
    // create app repo
    {
      to: apmRegistry.address,
      calldata: await apmRegistry.contract.methods
        .newRepoWithVersion(trgAppName, votingAddress, trgVersion, contractAddress, contentURI)
        .encodeABI(),
    },
    // link appId with implementations
    {
      to: kernel.address,
      calldata: await kernel.contract.methods.setApp(KERNEL_APP_BASES_NAMESPACE, trgAppId, contractAddress).encodeABI(),
    },
    // initialize module
    {
      to: trgApp.address,
      calldata: await trgApp.contract.methods
        .initialize(lidoLocatorAddress, '0x' + Buffer.from(moduleType).toString('hex').padEnd(64, '0'), penaltyDelay)
        .encodeABI(),
    },
  ]

  // set permissions

  // grant perm for staking router
  evmScriptCalls.push({
    to: acl.address,
    calldata: await acl.contract.methods
      .createPermission(srAddress, trgProxyAddress, STAKING_ROUTER_ROLE, votingAddress)
      .encodeABI(),
  })

  // grant perms to easytrack evm script executor
  evmScriptCalls.push({
    to: acl.address,
    calldata: await acl.contract.methods
      .grantPermission(easyTrackEVMScriptExecutor, trgProxyAddress, STAKING_ROUTER_ROLE)
      .encodeABI(),
  })

  evmScriptCalls.push({
    to: acl.address,
    calldata: await acl.contract.methods
      .createPermission(easyTrackEVMScriptExecutor, trgProxyAddress, MANAGE_NODE_OPERATOR_ROLE, votingAddress)
      .encodeABI(),
  })
  evmScriptCalls.push({
    to: acl.address,
    calldata: await acl.contract.methods
      .createPermission(easyTrackEVMScriptExecutor, trgProxyAddress, SET_NODE_OPERATOR_LIMIT_ROLE, votingAddress)
      .encodeABI(),
  })

  // grant manager to easytrack evm script executor
  evmScriptCalls.push({
    to: acl.address,
    calldata: await acl.contract.methods
      .createPermission(easyTrackEVMScriptExecutor, trgProxyAddress, MANAGE_SIGNING_KEYS, easyTrackEVMScriptExecutor)
      .encodeABI(),
  })

  // grant perms to easytrack factories
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.AddNodeOperators,
      trgProxyAddress +
        getSignature(trgApp, 'addNodeOperator').substring(2) +
        aclAddress.substring(2) +
        getSignature(acl, 'grantPermissionP').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.ActivateNodeOperators,
      trgProxyAddress +
        getSignature(trgApp, 'activateNodeOperator').substring(2) +
        aclAddress.substring(2) +
        getSignature(acl, 'grantPermissionP').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.DeactivateNodeOperators,
      trgProxyAddress +
        getSignature(trgApp, 'deactivateNodeOperator').substring(2) +
        aclAddress.substring(2) +
        getSignature(acl, 'revokePermission').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.SetVettedValidatorsLimits,
      trgProxyAddress + getSignature(trgApp, 'setNodeOperatorStakingLimit').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.UpdateTargetValidatorLimits,
      trgProxyAddress + getSignature(trgApp, 'updateTargetValidatorsLimits').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.SetNodeOperatorNames,
      trgProxyAddress + getSignature(trgApp, 'setNodeOperatorName').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.SetNodeOperatorRewardAddresses,
      trgProxyAddress + getSignature(trgApp, 'setNodeOperatorRewardAddress').substring(2),
    ]),
  })
  evmScriptCalls.push({
    to: easytrack.address,
    calldata: await easytrack.interface.encodeFunctionData('addEVMScriptFactory', [
      easyTrackFactories.ChangeNodeOperatorManager,
      aclAddress +
        getSignature(acl, 'revokePermission').substring(2) +
        aclAddress.substring(2) +
        getSignature(acl, 'grantPermissionP').substring(2),
    ]),
  })

  // check missed STAKING_MODULE_MANAGE_ROLE role on Agent
  if (!(await stakingRouter.hasRole(STAKING_MODULE_MANAGE_ROLE, voting.address))) {
    evmScriptCalls.push({
      to: agent.address,
      calldata: await agent.contract.methods
        .execute(
          stakingRouter.address,
          0,
          await stakingRouter.contract.methods.grantRole(STAKING_MODULE_MANAGE_ROLE, agent.address).encodeABI()
        )
        .encodeABI(),
    })
  }

  // allow to request burner, add REQUEST_BURN_SHARES_ROLE
  evmScriptCalls.push({
    to: agent.address,
    calldata: await agent.contract.methods
      .execute(
        burner.address,
        0,
        await burner.contract.methods.grantRole(REQUEST_BURN_SHARES_ROLE, trgProxyAddress).encodeABI()
      )
      .encodeABI(),
  })

  // add module to SR
  const addModuleCallData = await stakingRouter.contract.methods
    .addStakingModule(
      moduleName, // name
      trgProxyAddress, // module address
      targetShare,
      moduleFee,
      treasuryFee
    )
    .encodeABI()
  evmScriptCalls.push({
    to: agent.address,
    calldata: await agent.contract.methods.execute(stakingRouter.address, 0, addModuleCallData).encodeABI(),
  })

  const evmScript = encodeCallScript(evmScriptCalls)

  const evmScriptDecoder = new EVMScriptDecoder(
    new abiProviders.Local({
      [kernel.address]: kernel.abi,
      [acl.address]: acl.abi,
      [voting.address]: voting.abi,
      [agent.address]: agent.abi,
      [stakingRouter.address]: stakingRouter.abi,
      [apmRegistry.address]: apmRegistry.abi,
      [trgApp.address]: trgApp.abi,
      [easytrack.address]: easyTrackABI,
    })
  )

  const decodedEVMScript = await evmScriptDecoder.decodeEVMScript(evmScript)

  log('Decoded voting script:')
  for (const call of decodedEVMScript.calls) {
    if (call.abi) {
      const params = {}
      const inputs = call.abi.inputs || []
      for (let i = 0; i < inputs.length; ++i) {
        params[inputs[i].name] = call.decodedCallData[i]
      }
      log({ contract: call.address, method: call.abi.name, params })
    } else {
      log(call)
    }
  }

  log.splitter()
  await _pause()
  log.splitter()

  const newVoteEvmScript = encodeCallScript([
    {
      to: voting.address,
      calldata: await voting.contract.methods.newVote(evmScript, voteDesc, false, false).encodeABI(),
    },
  ])

  // skip update if VOTE_ID set
  if (!VOTE_ID) {
    // save app info
    persistNetworkState2(network.name, netId, state, {
      [`app:${trgAppName}`]: {
        fullName: trgAppFullName,
        name: trgAppName,
        id: trgAppId,
        ipfsCid,
        contentURI,
        implementation: contractAddress,
        contract: trgAppArtifact,
      },
    })
  }

  log.splitter()

  if (SIMULATE) {
    await _pause(mg('>>> Enter Y to start simulation, interrupt process otherwise:'))
    log.splitter()
    log(gr(`Simulating voting creation and enact!`))
    const voters = getVoters(
      agentAddress,
      state.vestingParams,
      await daoToken.totalSupply(),
      await voting.minAcceptQuorumPct()
    )

    let voteId
    if (!VOTE_ID) {
      // create voting on behalf ldo holder
      await ethers.getImpersonatedSigner(voters[0])
      log(`Creating voting on behalf holder`, yl(voters[0]))
      const result = await tokenManager.forward(newVoteEvmScript, { from: voters[0], gasPrice: 0 })
      voteId = getEventArgument(result, 'StartVote', 'voteId', { decodeForAbi: voting.abi })
      log(`Voting created, id`, yl(voteId))
    } else {
      voteId = VOTE_ID
    }

    // vote
    log(`Collect votes...`)
    for (const voter of voters) {
      await ethers.getImpersonatedSigner(voter)
      log(`Cast voting on behalf holder`, yl(voters[0]))
      await voting.vote(voteId, true, true, { from: voter, gasPrice: 0 })
    }
    const voteTime = (await voting.voteTime()).toNumber()
    // pass time and enact
    log(`Pass time...`)
    await ethers.provider.send('evm_increaseTime', [voteTime])
    await ethers.provider.send('evm_mine')
    log(`Enacting voting, id`, yl(voteId))
    await voting.executeVote(voteId, { from: deployer, gasPrice: 0 })

    log(`Target App initialized`, yl(await trgApp.hasInitialized()))
  } else {
    const tx = await log.tx(
      `Voting: Clone app '${srcAppName}' to '${trgAppName}'`,
      tokenManager.forward(newVoteEvmScript, { from: deployer })
    )

    const voteId = getEventArgument(tx, 'StartVote', 'voteId', { decodeForAbi: voting.abi })
    log(`Voting created, id`, yl(voteId))
  }
  // else {
  //   await saveCallTxData(
  //     `Voting: Clone app '${srcAppName}' to '${trgAppName}'`,
  //     tokenManager,
  //     'forward',
  //     `clone-tx-02-create-voting.json`,
  //     {
  //       arguments: [newVoteEvmScript],
  //       from: deployer,
  //     }
  //   )
  //   // console.log({ txData })

  //   log.splitter()
  //   log(gr(`Before continuing the cloning, please send voting creation transactions`))
  //   log(gr(`that you can find in the file listed above. You may use a multisig address`))
  //   log(gr(`if it supports sending arbitrary tx.`))
  // }

  log.splitter()
}

// try to get list of voters with most significant LDO amounts
function getVoters(agentAddress, vestingParams, daoTokenTotalSupply, quorumPcnt) {
  const agentBalance = toBN(vestingParams.unvestedTokensAmount)
  const holderBalances = Object.entries(vestingParams.holders)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .map(([h, b]) => [h, toBN(b)])

  const quorumBalance = (daoTokenTotalSupply * quorumPcnt) / ETH(1)

  const voters = []
  let voteBalance = ETH(0)
  if (agentBalance > 0) {
    voters.push(agentAddress)
    voteBalance += agentBalance
  }
  for (let i = 0; i < holderBalances.length; i++) {
    if (voteBalance >= quorumBalance) {
      break
    }
    // todo: check actual balance?
    voters.push(holderBalances[i][0])
    voteBalance += holderBalances[i][1]
  }

  return voters
}
module.exports = runOrWrapScript(deploySimpleDVT, module)
