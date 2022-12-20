const chalk = require('chalk')
const { log, logSplitter, logWideSplitter, logHeader, logTable, yl, bl, gr, rd, OK, NOT_OK, logTx } = require('../../scripts/helpers/log')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument, isBn, MAX_UINT256 } = require('@aragon/contract-helpers-test')
const {
  ethers: { provider }
} = require('hardhat')
const { Console } = require('winston/lib/winston/transports')

const StakingRouter = artifacts.require('StakingRouter.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')
const IStakingModule = artifacts.require('contracts/0.4.24/interfaces/IStakingModule.sol:IStakingModule')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock.sol')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

// const pad = (hex, bytesLength) => {
//   const absentZeroes = bytesLength * 2 + 2 - hex.length
//   if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
//   return hex
// }

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

// modules config
const proModule = {
  name: 'Curated',

  type: 0, // PRO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  targetShare: 10000,
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 9999,
  totalUsedKeys: 9998,
  totalStoppedKeys: 0
}

const soloModule = {
  name: 'Community',

  type: 1, // SOLO
  fee: 1100, // in basic points
  treasuryFee: 0, // in basic points
  targetShare: 100, // 1%
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 300,
  totalUsedKeys: 80,
  totalStoppedKeys: 10
}

const soloModule2 = {
  name: 'DVT',

  type: 2, // DVT
  fee: 800, // in basic points
  treasuryFee: 200, // in basic points
  targetShare: 200, // 2%
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 100,
  totalUsedKeys: 0,
  totalStoppedKeys: 0
}

const modules = []
modules.push(proModule)
modules.push(soloModule)
// modules.push(soloModule2)

contract('StakingRouter', (accounts) => {
  let oracle, lido, burner
  let treasuryAddr
  let dao, acl, operators

  let stakingRouter

  var appManager = accounts[0]
  var voting = accounts[1]
  var deployer = accounts[2]
  var externalAddress = accounts[3]
  var dsmBot = accounts[4]
  var stranger2 = accounts[5]
  /* create named accounts for contract roles */

  before(async () => {
    /* before tests */
    // logTable(modules)
  })

  beforeEach(async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistryMock.new({ from: deployer })

    const daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistryMock.at(proxyAddress)
    await operators.initialize(lido.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.SET_FEE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_TYPE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_STAKING_ROUTER_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    stakingRouter = await StakingRouter.new(depositContract.address, { from: appManager })

    // initialize
    await stakingRouter.initialize(lido.address, appManager)

    // Set up the staking router permissions.
    const MANAGE_WITHDRAWAL_KEY_ROLE = await stakingRouter.MANAGE_WITHDRAWAL_KEY_ROLE()
    const MODULE_PAUSE_ROLE = await stakingRouter.MODULE_PAUSE_ROLE()
    const MODULE_CONTROL_ROLE = await stakingRouter.MODULE_CONTROL_ROLE()
    const DEPOSIT_ROLE = await stakingRouter.DEPOSIT_ROLE()

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_KEY_ROLE, voting, { from: appManager })
    await stakingRouter.grantRole(MODULE_PAUSE_ROLE, voting, { from: appManager })
    await stakingRouter.grantRole(MODULE_CONTROL_ROLE, voting, { from: appManager })
    await stakingRouter.grantRole(DEPOSIT_ROLE, dsmBot, { from: appManager })

    const wc = '0x'.padEnd(66, '1234')
    await stakingRouter.setWithdrawalCredentials(wc, { from: voting })
    log('Set withdrawal credentials ' + gr(wc))

    // set staking router to lido
    await lido.setStakingRouter(stakingRouter.address)

    const total = await lido.totalSupply()
    const shares = await lido.getTotalShares()

    log('--- initialize ---')
    log('lido balance', total.toString())
    log('lido shares', shares.toString())
  })

  describe('staking router test', () => {
    beforeEach(async () => {
      log('--- stranger1 send 20eth ---')
      await web3.eth.sendTransaction({ from: externalAddress, to: lido.address, value: ETH(2000) })
      log('--- stranger1 send 10eth ---')
      await web3.eth.sendTransaction({ from: stranger2, to: lido.address, value: ETH(1230) })
      // 50% of mintedShares
      await operators.setFee(500, { from: voting })
      const NORFee = await operators.getFee()
      assertBn(500, NORFee, 'invalid node operator registry fee')
    })

    it(`base functions`, async () => {
      // 50% of mintedShares
      await operators.setFee(500, { from: voting })

      // add NodeOperatorRegistry
      // name, address, cap, treasuryFee
      await stakingRouter.addModule('Curated', operators.address, proModule.targetShare, proModule.treasuryFee, {
        from: voting
      })

      await operators.setTotalKeys(proModule.totalKeys, { from: appManager })
      await operators.setTotalUsedKeys(proModule.totalUsedKeys, { from: appManager })
      await operators.setTotalStoppedKeys(proModule.totalStoppedKeys, { from: appManager })

      const NORFee = await operators.getFee()
      assertBn(500, NORFee, 'invalid node operator registry fee')

      /**
       *
       *  INITIALIZE modules
       *
       */
      for (let i = 0; i < modules.length; i++) {
        const module = modules[i]
        let _module

        // add pro module
        if (module.type === 0) {
          continue
          // add solo module
        } else if (module.type === 1) {
          _module = await ModuleSolo.new(module.type, lido.address, module.fee, { from: appManager })
        }

        const name = module.name

        log(`module ${name} address`, _module.address)

        await stakingRouter.addModule(name, _module.address, module.targetShare, module.treasuryFee, {
          from: voting
        })
        await _module.setTotalKeys(module.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(module.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(module.totalStoppedKeys, { from: appManager })

        module.address = _module.address
      }

      await getLidoStats(lido, { Stranger1: externalAddress, Stranger2: stranger2, StakingRouter: stakingRouter.address })

      log('Before allocation')
      let table = await getModulesInfo(stakingRouter)

      lidoBalance = await web3.eth.getBalance(lido.address)
      lidoBuffered = await lido.getBufferedEther()
      lidoSrBuffered = await lido.getStakingRouterBufferedEther()
      balance = await web3.eth.getBalance(stakingRouter.address)
      log('lido balance:', yl(lidoBalance))
      log('lido lidoBuffered:', yl(lidoBuffered))
      log('lido lidoSrBuffered:', yl(lidoSrBuffered))
      log('stakingRouter balance:', yl(balance))

      logWideSplitter(bl(`call Lido.transferToStakingRouter()`))
      await lido.transferToStakingRouter(101);
      lidoBalance = await web3.eth.getBalance(lido.address)
      lidoBuffered = await lido.getBufferedEther()
      lidoSrBuffered = await lido.getStakingRouterBufferedEther()
      balance = await web3.eth.getBalance(stakingRouter.address)

      log('lido balance:', yl(lidoBalance))
      log('lido lidoBuffered:', yl(lidoBuffered))
      log('lido lidoSrBuffered:', yl(lidoSrBuffered))
      log('stakingRouter balance:', yl(balance))

      // const { cache, newTotalAllocation } = await stakingRouter.getAllocation(10)
      // log({ newTotalAllocation, cache })
      // first distribute
      logWideSplitter(bl(`call distributeDeposits()`))
      await stakingRouter.distributeDeposits()
      log(OK, `- ${gr('NO revert')}!`)

      const alloc = await getAndCheckAlloc(stakingRouter)
      log('last distribute', (await stakingRouter.getLastDistributeAt()).toString())

      const modulesCount = await stakingRouter.getModulesCount()
      log('Modules count', parseInt(modulesCount))

      const curatedModule = await stakingRouter.getModule(0)
      const communityModule = await stakingRouter.getModule(1)

      const curModule = await NodeOperatorsRegistryMock.at(curatedModule.moduleAddress)
      const comModule = await ModuleSolo.at(communityModule.moduleAddress)

      log('Set staking router for modules')
      curModule.setStakingRouter(stakingRouter.address, { from: voting })
      comModule.setStakingRouter(stakingRouter.address, { from: voting })

      const keys1 = genKeys(3)
      log(bl('DEPOSIT 3 keys COMMUNITY module'))
      await stakingRouter.deposit(3, comModule.address, hexConcat(keys1.pubkeys, keys1.sigkeys), {'from': dsmBot})

      lidoBalance = await web3.eth.getBalance(lido.address)
      lidoBuffered = await lido.getBufferedEther()
      lidoSrBuffered = await lido.getStakingRouterBufferedEther()
      balance = await web3.eth.getBalance(stakingRouter.address)
      log('lido balance:', yl(lidoBalance))
      log('lido lidoBuffered:', yl(lidoBuffered))
      log('lido lidoSrBuffered:', yl(lidoSrBuffered))
      log('stakingRouter balance:', yl(balance))

      await getAndCheckAlloc(stakingRouter)
      await getModulesInfo(stakingRouter)

      // update
      log('add node operator to curated module')
      await curModule.addNodeOperator('fo o', ADDRESS_1, { from: voting })

      log('add keys to node operator curated module')
      for (let i = 0; i < 10; i++) {
        const keys = genKeys(1)
        await curModule.addSigningKeys(0, 1, keys.pubkeys, keys.sigkeys, { from: voting })
      }

      const operator = await curModule.getNodeOperator(0, true)
      assert.equal(operator.active, true)
      assert.equal(operator.name, 'fo o')
      assert.equal(operator.rewardAddress, ADDRESS_1)
      assertBn(operator.stakingLimit, 0)
      assertBn(operator.stoppedValidators, 0)
      assertBn(operator.totalSigningKeys, 10)
      assertBn(operator.usedSigningKeys, 0)

      log('increase staking limit to 1000')
      await curModule.setNodeOperatorStakingLimit(0, 1000, { from: voting })

      console.log('before deposit')
      table = await getModulesInfo(stakingRouter)

      log(bl('DEPOSIT 1 key for curated module'))
      await stakingRouter.deposit(1, curModule.address, '0x', {'from': dsmBot})

      console.log('after deposit')
      table = await getModulesInfo(stakingRouter)

      // 3
      await getAndCheckAlloc(stakingRouter)
      await getModulesInfo(stakingRouter)

      balance_3 = await web3.eth.getBalance(stakingRouter.address)
      log('StakingRouter balance3:', yl(balance_3))

      // 4 try to deposit more from cureated module

      // wait 12 hour
      const waitTime = 3600 * 12
      log(gr('WAIT ', waitTime))

      await ethers.provider.send('evm_increaseTime', [waitTime])
      await ethers.provider.send('evm_mine')

      log(bl('try to DEPOSIT 3 key for curated module'))
      await assertRevert(stakingRouter.deposit(3, curModule.address, '0x', { 'from': dsmBot }), 'EMPTY_ALLOCATION')

      await getAndCheckAlloc(stakingRouter)
      await getModulesInfo(stakingRouter)

      balance_4 = await web3.eth.getBalance(stakingRouter.address)
      log('StakingRouter balance4:', yl(balance_4))
    })
  })
})

async function getLidoStats(lido, args) {
  const data = {}

  const total = await lido.totalSupply()
  const shares = await lido.getTotalShares()

  data.Lido = { total: total.toString(), shares: shares.toString() }

  for (const property in args) {
    const prop = args[property]

    const prop1balance = await lido.balanceOf(prop)
    const prop1shares = await lido.getSharesByPooledEth(prop1balance)

    data[`${property}`] = {
      total: prop1balance.toString(),
      shares: prop1shares.toString()
    }
  }

  logTable(data)
}

async function getAndCheckAlloc(stakingRouter, allocCheck = undefined) {
  const alloc = { assignedKeys: [] }
  const modulesCount = await stakingRouter.getModulesCount()
  for (let i = 0; i < modulesCount; i++) {
    alloc.assignedKeys.push((await stakingRouter.allocation(i)).toNumber())
  }
  log('>>> Allocation <<<')
  logTable(alloc)
  if (allocCheck) {
    const { assignedKeys } = allocCheck
    assert.deepEqual(alloc.assignedKeys, assignedKeys)
  }
  return alloc
}

async function getModulesInfo(stakingRouter) {
  const modulesCount = await stakingRouter.getModulesCount()
  const table = []
  for (let i = 0; i < modulesCount; i++) {
    const comModule = await stakingRouter.getModule(i)
    const entry = await IStakingModule.at(comModule.moduleAddress)

    table.push({
      name: comModule.name,
      targetShare: +comModule.targetShare,
      fee: +(await entry.getFee()),
      treasuryFee: parseInt(comModule.treasuryFee),
      paused: comModule.paused,
      active: comModule.active,
      lastDepositAt: +comModule.lastDepositAt,

      totalKeys: +(await entry.getTotalKeys()),
      totalUsedKeys: +(await entry.getTotalUsedKeys()),
      totalStoppedKeys: +(await entry.getTotalStoppedKeys())
    })
  }
  log('>>> Modules state <<<')
  logTable(table)
  return table
}

function genKeys(cnt = 1) {
  let pubkeys = ''
  let sigkeys = ''

  for (let i = 1; i <= cnt; i++) {
    pubkeys = hexConcat(pubkeys, `0x`.padEnd(98, i.toString(16))) // 48 bytes * 2 chars + 2 chars (0x)
    sigkeys = hexConcat(sigkeys, `0x`.padEnd(194, i.toString(16))) // 96 bytes * 2 chars + 2 chars (0x)
  }

  return { pubkeys, sigkeys }
}


48+48+96+96

288-96*2