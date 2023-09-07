const { artifacts, contract, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { hash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { getEventAt } = require('@aragon/contract-helpers-test')

const { EvmSnapshot } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { createVote, enactVote } = require('../helpers/voting')
const { setupNodeOperatorsRegistry, NodeOperatorsRegistry } = require('../helpers/staking-modules')
const { padRight } = require('../helpers/utils')

const StakingRouter = artifacts.require('StakingRouter')

const {
  lidoMockFactory,
  oracleReportSanityCheckerStubFactory,
  votingFactory,
  hashConsensusFactory,
  stakingRouterFactory,
  addStakingModulesWrapper,
  postSetup,
} = require('../helpers/factories')

// bytes32 0x63757261746564
const CURATED_TYPE = padRight(web3.utils.fromAscii('curated'), 32)
// const PENALTY_DELAY = 2 * 24 * 60 * 60 // 2 days

const KERNEL_APP_BASES_NAMESPACE = '0xf1f3eb40f5bc1ad1344716ced8b8a0431d840b5783aea1fd01786bc26f35ac0f'

contract('Simple DVT', ([appManager, , , , , , , , , , , , user1, user2, user3, nobody, depositor, treasury]) => {
  let operators
  let dao
  let stakingRouter
  let lidoLocator
  let snapshot
  let acl
  let voting
  let tokenManager
  // let pool

  before('deploy base app', async () => {
    const deployed = await deployProtocol({
      oracleReportSanityCheckerFactory: oracleReportSanityCheckerStubFactory,
      lidoFactory: (protocol) => {
        return lidoMockFactory({ ...protocol, voting: protocol.appManager })
      },
      stakingRouterFactory: (protocol) => {
        return stakingRouterFactory({ ...protocol, voting: protocol.appManager })
      },
      hashConsensusFactory: (protocol) => {
        return hashConsensusFactory({ ...protocol, voting: protocol.appManager })
      },
      postSetup: (protocol) => {
        return postSetup({ ...protocol, voting: protocol.appManager })
      },
      addStakingModulesWrapper: (protocol, stakingModules) => {
        return addStakingModulesWrapper({ ...protocol, voting: protocol.appManager }, stakingModules)
      },
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry({ ...protocol, voting: protocol.appManager }, false)

        // await protocol.acl.grantPermission(
        //   protocol.appManager.address,
        //   curatedModule.address,
        //   await curatedModule.MANAGE_NODE_OPERATOR_ROLE()
        // )
        // await protocol.acl.grantPermission(
        //   protocol.appManager.address,
        //   curatedModule.address,
        //   await curatedModule.MANAGE_NODE_OPERATOR_ROLE()
        // )

        // await protocol.acl.grantPermission(
        //   protocol.appManager.address,
        //   protocol.stakingRouter.address,
        //   await protocol.stakingRouter.STAKING_MODULE_MANAGE_ROLE()
        // )

        await protocol.stakingRouter.grantRole(
          await protocol.stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
          protocol.voting.address,
          {
            from: protocol.appManager.address,
          }
        )

        return [
          {
            module: curatedModule,
            name: 'SimpleDVT',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
      votingFactory,
      depositSecurityModuleFactory: async () => {
        return { address: depositor }
      },
    })

    dao = deployed.dao
    acl = deployed.acl
    stakingRouter = deployed.stakingRouter
    operators = deployed.stakingModules[0]
    lidoLocator = deployed.lidoLocator
    tokenManager = deployed.tokenManager
    voting = deployed.voting
    // pool = deployed.pool

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  const newAppProxy = async (dao, appId) => {
    const receipt = await dao.newAppProxy(dao.address, appId)

    // Find the deployed proxy address in the tx logs.
    const logs = receipt.logs
    const log = logs.find((l) => l.event === 'NewAppProxy')
    const proxyAddress = log.args.proxy

    return proxyAddress
  }

  describe('clone NOR to simple-dvt', () => {
    const cloneAppName = 'simple-dvt'
    const cloneAppId = hash(`${cloneAppName}.aragonpm.test`)
    let cloneAppProxyAddress
    let cloneApp

    const moduleName = 'SimpleDVT'
    const penaltyDelay = 3600
    const targetShare = 1000 // 10%
    const moduleFee = 500
    const treasuryFee = 500

    let norAppId
    let norBaseImpl

    async function checkCloneModule(tx) {
      const addEvent = getEventAt(tx, 'StakingModuleAdded', { decodeForAbi: StakingRouter.abi })

      assert.equals(addEvent.args.stakingModuleId, 2)
      assert.equals(addEvent.args.stakingModule.toLowerCase(), cloneApp.address.toLowerCase())
      assert.equals(addEvent.args.name, moduleName)

      assert.equals(await stakingRouter.getStakingModulesCount(), 2)

      const moduleInfo = await stakingRouter.getStakingModule(2)
      // assert.equals(moduleType, CURATED_TYPE)

      assert.equals(moduleInfo.name, moduleName)
      assert.equals(moduleInfo.stakingModuleAddress, cloneApp.address)
      assert.equals(moduleInfo.stakingModuleFee, moduleFee)
      assert.equals(moduleInfo.treasuryFee, treasuryFee)
      assert.equals(moduleInfo.targetShare, targetShare)

      const moduleSummary = await stakingRouter.getStakingModuleSummary(2)
      assert.equals(moduleSummary.totalExitedValidators, 0)
      assert.equals(moduleSummary.totalDepositedValidators, 0)
      assert.equals(moduleSummary.depositableValidatorsCount, 0)
    }

    before(async () => {
      norAppId = await operators.appId()
      norBaseImpl = await dao.getApp(KERNEL_APP_BASES_NAMESPACE, norAppId)
    })

    it('manual clone', async () => {
      // deploy stub proxy
      cloneAppProxyAddress = await newAppProxy(dao, cloneAppId)
      cloneApp = await NodeOperatorsRegistry.at(cloneAppProxyAddress)

      // setup aragon app
      await dao.setApp(KERNEL_APP_BASES_NAMESPACE, cloneAppId, norBaseImpl, { from: appManager })
      assert.equal(await dao.getApp(KERNEL_APP_BASES_NAMESPACE, await cloneApp.appId()), norBaseImpl)

      // initialize module
      await cloneApp.initialize(lidoLocator.address, CURATED_TYPE, penaltyDelay, { from: nobody })
      assert.equal(await cloneApp.getType(), CURATED_TYPE)
      assert.equal(await cloneApp.getStuckPenaltyDelay(), penaltyDelay)

      // set roles

      await Promise.all([
        // Allow voting to manage node operators registry
        acl.createPermission(appManager, cloneApp.address, await operators.MANAGE_SIGNING_KEYS(), appManager, {
          from: appManager,
        }),
        acl.createPermission(appManager, cloneApp.address, await operators.MANAGE_NODE_OPERATOR_ROLE(), appManager, {
          from: appManager,
        }),
        acl.createPermission(appManager, cloneApp.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, {
          from: appManager,
        }),
        acl.createPermission(
          stakingRouter.address,
          cloneApp.address,
          await operators.STAKING_ROUTER_ROLE(),
          appManager,
          {
            from: appManager,
          }
        ),
      ])

      // add to SR
      const tx = await stakingRouter.addStakingModule(
        moduleName, // name
        cloneApp.address, // module name
        targetShare,
        moduleFee,
        treasuryFee,
        { from: appManager.address }
      )

      await checkCloneModule(tx)
    })

    it('via voting', async () => {
      // deploy stub proxy
      cloneAppProxyAddress = await newAppProxy(dao, cloneAppId)
      cloneApp = await NodeOperatorsRegistry.at(cloneAppProxyAddress)

      const evmScriptCalls = [
        // {
        //   // registry.newRepoWithVersion(appName, aclGrantee, initialSemanticVersion, contractAddress, contentURI)
        //   to: apm.address,
        //   calldata: await apm.contract.methods
        //     .newRepoWithVersion(trgAppName, voting.address, version, contractAddress, contentURI)
        //     .encodeABI(),
        // },
        // setup aragon app
        {
          to: dao.address,
          calldata: await dao.contract.methods.setApp(KERNEL_APP_BASES_NAMESPACE, cloneAppId, norBaseImpl).encodeABI(),
        },
        // initialize module
        {
          to: cloneApp.address,
          calldata: await cloneApp.contract.methods
            .initialize(lidoLocator.address, CURATED_TYPE, penaltyDelay)
            .encodeABI(),
        },

        // set roles
        {
          to: acl.address,
          calldata: await acl.contract.methods
            .createPermission(voting.address, cloneApp.address, await operators.MANAGE_SIGNING_KEYS(), voting.address)
            .encodeABI(),
        },
        {
          to: acl.address,
          calldata: await acl.contract.methods
            .createPermission(
              voting.address,
              cloneApp.address,
              await operators.MANAGE_NODE_OPERATOR_ROLE(),
              voting.address
            )
            .encodeABI(),
        },
        {
          to: acl.address,
          calldata: await acl.contract.methods
            .createPermission(
              voting.address,
              cloneApp.address,
              await operators.SET_NODE_OPERATOR_LIMIT_ROLE(),
              voting.address
            )
            .encodeABI(),
        },
        {
          to: acl.address,
          calldata: await acl.contract.methods
            .createPermission(
              stakingRouter.address,
              cloneApp.address,
              await operators.STAKING_ROUTER_ROLE(),
              voting.address
            )
            .encodeABI(),
        },

        // add to SR
        {
          to: stakingRouter.address,
          calldata: await stakingRouter.contract.methods
            .addStakingModule(
              moduleName, // name
              cloneApp.address, // module name
              targetShare,
              moduleFee,
              treasuryFee
            )
            .encodeABI(),
        },
      ]

      const voteId = await createVote(voting, tokenManager, `Clone NOR`, encodeCallScript(evmScriptCalls), {
        from: appManager,
      })
      await voting.vote(voteId, true, true, { from: appManager })

      const tx = await enactVote(voting, voteId, { from: appManager })

      await checkCloneModule(tx)
    })
  })
})
