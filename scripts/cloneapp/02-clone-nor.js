const { network, ethers } = require('hardhat')
const chalk = require('chalk')

const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { getEventArgument } = require('@aragon/contract-helpers-test')

const runOrWrapScript = require('../helpers/run-or-wrap-script')

const { log, yl, gr, rd } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { getDeployer, readStateAppAddress } = require('./helpers')
const { resolveLatestVersion } = require('../components/apm')
const {
  readNetworkState,
  assertRequiredNetworkState,
  persistNetworkState2,
} = require('../helpers/persisted-network-state')

const { resolveEnsAddress } = require('../components/ens')
const { hash: namehash } = require('eth-ens-namehash')

const { APP_NAMES, APP_ARTIFACTS } = require('../constants')

const APP_TRG = process.env.APP_TRG || 'simple-dvt'
const DEPLOYER = process.env.DEPLOYER || ''
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

const KERNEL_APP_BASES_NAMESPACE = '0xf1f3eb40f5bc1ad1344716ced8b8a0431d840b5783aea1fd01786bc26f35ac0f'

async function deployNORClone({ web3, artifacts, trgAppName = APP_TRG }) {
  const netId = await web3.eth.net.getId()

  const srcAppName = APP_NAMES.NODE_OPERATORS_REGISTRY

  log.splitter()
  log(`Network ID: ${chalk.yellow(netId)}`)

  const deployer = await getDeployer(web3, DEPLOYER)
  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat([`app:${srcAppName}`, `app:${trgAppName}`]))

  log.splitter()

  log(`Using ENS:`, yl(state.ensAddress))
  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const lidoLocatorAddress = readStateAppAddress(state, `lidoLocator`)
  log(`Lido Locator:`, yl(lidoLocatorAddress))
  log.splitter()

  const srcAppFullName = `${srcAppName}.${state.lidoApmEnsName}`
  const srcAppId = namehash(srcAppFullName)
  const { semanticVersion, contractAddress, contentURI } = await resolveLatestVersion(srcAppId, ens, artifacts)
  const srcVersion = semanticVersion.map((n) => n.toNumber())
  // strip 0x from content uri, then strip 'ipfs:' prefix
  const ipfsCid = Buffer.from(contentURI.substring(2), 'hex').toString().substring(5)

  log(`Source App:`, yl(srcAppName))
  log(`Source App ENS:`, yl(srcAppFullName))
  log(`Source App ID:`, yl(srcAppId))
  log(`Source Contract implementation:`, yl(contractAddress))
  log(`Source Content URI:`, yl(contentURI))
  log(`Source Content IPFS CID:`, yl(ipfsCid))
  log(`Source App version:`, yl(srcVersion.join('.')))

  log.splitter()
  const trgAppFullName = `${trgAppName}.${state.lidoApmEnsName}`
  const trgAppId = namehash(trgAppFullName)
  const trgRepoAddress = await resolveEnsAddress(artifacts, ens, trgAppId)
  const trgProxyAddress = readStateAppAddress(state, `app:${trgAppName}`)
  const trgAppArtifact = APP_ARTIFACTS[srcAppName] // get source app artifact

  // set new version to 1.0.0
  const trgVersion = [1, 0, 0]
  log(`Target App:`, yl(trgAppName))
  log(`Target App ENS:`, yl(trgAppFullName))
  log(`Target App ID:`, yl(trgAppId))
  log(`Target App proxy`, yl(trgProxyAddress))
  log(`Target Contract implementation:`, yl(contractAddress))
  log(`Target Content URI:`, yl(contentURI))
  log(`Target App version:`, yl(trgVersion.join('.')))

  log.splitter()
  const {
    moduleName,
    moduleType = 'curated',
    targetShare = 1000,
    moduleFee = 500,
    treasuryFee = 500,
    penaltyDelay,
  } = state[`app:${trgAppName}`].stakingRouterModuleParams
  log(`Target SR Module name`, yl(moduleName))
  log(`Target SR Module type`, yl(moduleType))
  log(`Target SR Module fee`, yl(moduleFee))
  log(`Target SR Module targetShare`, yl(targetShare))
  log(`Target SR Module treasuryFee`, yl(treasuryFee))
  log(`Target SR Module penaltyDelay`, yl(penaltyDelay))

  if (!trgProxyAddress || (await web3.eth.getCode(trgProxyAddress)) === '0x') {
    log.error(`Target app proxy is not yet deployed!`)
    return
  }

  if (trgRepoAddress && (await web3.eth.getCode(trgProxyAddress)) !== '0x') {
    log(`Target App APM repo:`, yl(trgRepoAddress))
    log.error(`Target app is already deployed!`)
    return
  }

  // clone source app info
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

  // preload voting and stakingRouter addresses
  const votingAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_VOTING}`)
  const tokenManagerAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`)
  const srAddress = readStateAppAddress(state, 'stakingRouter')

  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const stakingRouter = await artifacts.require('StakingRouter').at(srAddress)
  const apmRegistry = await artifacts.require('APMRegistry').at(state.lidoApmAddress)

  const trgApp = await artifacts.require(trgAppArtifact).at(trgProxyAddress)
  const voteDesc = `Clone app '${srcAppName}' to '${trgAppName}'`
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const agentAddress = readStateAppAddress(state, `app:${APP_NAMES.ARAGON_AGENT}`)
  const agent = await artifacts.require('Agent').at(agentAddress)

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
  const srcAppPerms = [
    {
      grantee: votingAddress, // default to voting
      roles: {
        MANAGE_SIGNING_KEYS: '0x75abc64490e17b40ea1e66691c3eb493647b24430b358bd87ec3e5127f1621ee',
        MANAGE_NODE_OPERATOR_ROLE: '0x78523850fdd761612f46e844cf5a16bda6b3151d6ae961fd7e8e7b92bfbca7f8',
        SET_NODE_OPERATOR_LIMIT_ROLE: '0x07b39e0faf2521001ae4e58cb9ffd3840a63e205d288dc9c93c3774f0d794754',
      },
    },
    {
      grantee: srAddress,
      roles: { STAKING_ROUTER_ROLE: '0xbb75b874360e0bfd87f964eadd8276d8efb7c942134fc329b513032d0803e0c6' },
    },
  ]
  for (const group of srcAppPerms) {
    for (const roleId of Object.values(group.roles)) {
      evmScriptCalls.push({
        to: acl.address,
        calldata: await acl.contract.methods
          .createPermission(group.grantee, trgProxyAddress, roleId, votingAddress)
          .encodeABI(),
      })
    }
  }

  // check missed STAKING_MODULE_MANAGE_ROLE role
  const STAKING_MODULE_MANAGE_ROLE = '0x3105bcbf19d4417b73ae0e58d508a65ecf75665e46c2622d8521732de6080c48'
  if (!(await stakingRouter.hasRole(STAKING_MODULE_MANAGE_ROLE, voting.address))) {
    const grantRoleCallData = await stakingRouter.contract.methods
      .grantRole(STAKING_MODULE_MANAGE_ROLE, voting.address)
      .encodeABI()
    evmScriptCalls.push({
      to: agent.address,
      calldata: await agent.contract.methods.execute(stakingRouter.address, 0, grantRoleCallData).encodeABI(),
    })
  }

  // add to SR
  evmScriptCalls.push({
    to: stakingRouter.address,
    calldata: await stakingRouter.contract.methods
      .addStakingModule(
        moduleName, // name
        trgProxyAddress, // module address
        targetShare,
        moduleFee,
        treasuryFee
      )
      .encodeABI(),
  })

  const newVoteEvmScript = encodeCallScript([
    {
      to: voting.address,
      calldata: await voting.contract.methods
        .newVote(encodeCallScript(evmScriptCalls), voteDesc, false, false)
        .encodeABI(),
    },
  ])

  // console.log({ newVoteEvmScript })

  if (SIMULATE) {
    log.splitter()
    log(rd(`Simulating voting creation and enact!`))

    // create voting on behalf of dao agent
    await ethers.getImpersonatedSigner(agentAddress)

    const result = await tokenManager.forward(newVoteEvmScript, { from: agentAddress, gasPrice: 0 })
    const voteId = getEventArgument(result, 'StartVote', 'voteId', { decodeForAbi: voting.abi })
    log(`Vote Id`, yl(voteId))

    // vote
    await voting.vote(voteId, true, true, { from: agentAddress, gasPrice: 0 })
    const voteTime = (await voting.voteTime()).toNumber()
    // pass time and enact
    await ethers.provider.send('evm_increaseTime', [voteTime])
    await ethers.provider.send('evm_mine')
    await voting.executeVote(voteId, { from: deployer, gasPrice: 0 })

    log(`Target App initialized`, yl(await trgApp.hasInitialized()))
  } else {
    await saveCallTxData(
      `Voting: Clone app '${srcAppName}' to '${trgAppName}'`,
      tokenManager,
      'forward',
      `clone-tx-02-create-voting.json`,
      {
        arguments: [newVoteEvmScript],
        from: deployer,
      }
    )
    // console.log({ txData })

    log.splitter()
    log(gr(`Before continuing the cloning, please send voting creation transactions`))
    log(gr(`that you can find in the file listed above. You may use a multisig address`))
    log(gr(`if it supports sending arbitrary tx.`))
  }

  log.splitter()
}

module.exports = runOrWrapScript(deployNORClone, module)
