const hre = require('hardhat')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const withdrawals = require('../helpers/withdrawals')
const { ETH, genKeys } = require('../helpers/utils')
const { assert } = require('../helpers/assert')
const { EvmSnapshot } = require('../helpers/blockchain')

const LidoMock = artifacts.require('LidoMock.sol')
const WstETH = artifacts.require('WstETH.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')
const StakingRouter = artifacts.require('StakingRouterMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')

contract('StakingRouter', (accounts) => {
  const snapshot = new EvmSnapshot(hre.ethers.provider)
  let depositContract, stakingRouter
  let dao, acl, lido, oracle
  const [deployer, voting, admin, treasury, stranger1, dsm, address1, address2, dummy] = accounts

  before(async () => {
    const lidoBase = await LidoMock.new({ from: deployer })

    const daoObject = await newDao(deployer)
    dao = daoObject.dao
    acl = daoObject.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    const proxyAddress = await newApp(dao, 'lido', lidoBase.address, deployer)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    depositContract = await DepositContractMock.new({ from: deployer })
    stakingRouter = await StakingRouter.new(depositContract.address, { from: deployer })

    // Oracle
    oracle = await LidoOracleMock.new({ from: deployer })

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.initialize(admin, lido.address, wc, { from: deployer })

    // Set up the staking router permissions.
    const [MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, STAKING_MODULE_PAUSE_ROLE, STAKING_MODULE_MANAGE_ROLE] = await Promise.all([
      stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
      stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
      stakingRouter.STAKING_MODULE_MANAGE_ROLE()
    ])

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, voting, { from: admin })
    await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting, { from: admin })

    const wsteth = await WstETH.new(lido.address)
    const withdrawalQueue = (await withdrawals.deploy(dao.address, lido.address, wsteth.address)).queue

    await lido.initialize(oracle.address, treasury, stakingRouter.address, dsm, dummy, withdrawalQueue.address, dummy)

    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.revert()
  })

  describe('deposit', async () => {
    it('check two modules splitted deposit', async () => {
      // balance are 0
      assert.equals(await web3.eth.getBalance(lido.address), 0)
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0)

      const sendEthForKeys = ETH(200 * 32)
      const maxDepositsCount = 100

      await web3.eth.sendTransaction({ value: sendEthForKeys, to: lido.address, from: stranger1 })
      assert.equals(await lido.getBufferedEther(), sendEthForKeys)
      const nodeOperatorsRegistryBase = await NodeOperatorsRegistryMock.new({ from: deployer })
      const [proxyAddress, anotherProxyAddress] = await Promise.all([
        await newApp(dao, 'node-operators-registry-1', nodeOperatorsRegistryBase.address, deployer),
        await newApp(dao, 'node-operators-registry-2', nodeOperatorsRegistryBase.address, deployer)
      ])

      const [curated, anotherCurated] = await Promise.all([
        NodeOperatorsRegistryMock.at(proxyAddress),
        NodeOperatorsRegistryMock.at(anotherProxyAddress)
      ])

      await Promise.all([curated.initialize(lido.address, '0x01'), anotherCurated.initialize(lido.address, '0x01')])

      await Promise.all([
        acl.createPermission(voting, curated.address, await curated.ADD_NODE_OPERATOR_ROLE(), deployer, { from: deployer }),
        acl.createPermission(voting, curated.address, await curated.MANAGE_SIGNING_KEYS(), deployer, { from: deployer }),
        acl.createPermission(voting, curated.address, await curated.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer, { from: deployer }),
        acl.createPermission(voting, anotherCurated.address, await anotherCurated.ADD_NODE_OPERATOR_ROLE(), deployer, {
          from: deployer
        }),
        acl.createPermission(voting, anotherCurated.address, await anotherCurated.MANAGE_SIGNING_KEYS(), deployer, { from: deployer }),
        acl.createPermission(voting, anotherCurated.address, await anotherCurated.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer, {
          from: deployer
        }),
        acl.createPermission(stakingRouter.address, curated.address, await curated.REQUEST_VALIDATORS_KEYS_FOR_DEPOSITS_ROLE(), deployer, {
          from: deployer
        }),
        acl.createPermission(stakingRouter.address, curated.address, await curated.INVALIDATE_READY_TO_DEPOSIT_KEYS_ROLE(), deployer, {
          from: deployer
        })
      ])

      const keysAmount = maxDepositsCount
      const keys1 = genKeys(keysAmount)

      await curated.addNodeOperator('1', address1, { from: voting })
      await anotherCurated.addNodeOperator('1', address2, { from: voting })

      await curated.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })
      await anotherCurated.addSigningKeys(0, keysAmount, keys1.pubkeys, keys1.sigkeys, { from: voting })

      await curated.setNodeOperatorStakingLimit(0, 100000, { from: voting, gasPrice: 10 })
      await anotherCurated.setNodeOperatorStakingLimit(0, 100000, { from: voting, gasPrice: 10 })

      await stakingRouter.addStakingModule(
        'Curated',
        curated.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting, gasPrice: 10 }
      )
      await stakingRouter.addStakingModule(
        'Another curated',
        anotherCurated.address,
        10_000, // 100 % _targetShare
        1_000, // 10 % _moduleFee
        5_000, // 50 % _treasuryFee
        { from: voting, gasPrice: 10 }
      )

      const keysAllocation = await stakingRouter.getKeysAllocation(200)

      assert.equals(keysAllocation.allocated, 200)
      assert.equals(keysAllocation.allocations, [100, 100])

      const [curatedModule] = await stakingRouter.getStakingModules()

      await lido.deposit(maxDepositsCount, curatedModule.id, '0x', { from: dsm, gasPrice: 10 })

      assert.equals(await depositContract.totalCalls(), 100, 'invalid deposits count')

      // on deposit we return balance to Lido
      assert.equals(await web3.eth.getBalance(lido.address), ETH(100 * 32), 'invalid lido balance')
      assert.equals(await web3.eth.getBalance(stakingRouter.address), 0, 'invalid staking_router balance')

      assert.equals(await lido.getBufferedEther(), ETH(100 * 32), 'invalid total buffer')
    })
  })
})
