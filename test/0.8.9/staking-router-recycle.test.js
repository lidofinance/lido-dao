const chalk = require('chalk')

const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')
const {
  ethers: { provider }
} = require('hardhat')

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

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

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
  softCap: 10000,
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
  softCap: 100, // 1%
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 100,
  totalUsedKeys: 0,
  totalStoppedKeys: 0
}

const soloModule2 = {
  name: 'DVT',

  type: 2, // DVT
  fee: 800, // in basic points
  treasuryFee: 200, // in basic points
  softCap: 200, // 2%
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 500,
  totalUsedKeys: 0,
  totalStoppedKeys: 0
}

const ModuleTypes = ['PRO', 'SOLO', 'DVT']

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
  var unprivilegedAddress = accounts[4]
  var stranger2 = accounts[5]
  /* create named accounts for contract roles */

  before(async () => {
    /* before tests */
    // console.table(modules)
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

    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    stakingRouter = await StakingRouter.new(lido.address, depositContract.address, { from: appManager })

    // set staking router to lido
    await lido.setStakingRouter(stakingRouter.address)

    const wc = '0x'.padEnd(66, '1234')
    await lido.setWithdrawalCredentials(wc, { from: voting })
    console.log('Set withdrawal credentials ' + g(wc))

    const total = await lido.totalSupply()
    const shares = await lido.getTotalShares()

    console.log('--- initialize ---')
    console.log('lido balance', total.toString())
    console.log('lido shares', shares.toString())
  })

  describe('staking router test', () => {
    beforeEach(async () => {
      console.log('--- stranger1 send 20eth ---')
      await web3.eth.sendTransaction({ from: externalAddress, to: lido.address, value: ETH(20) })
      console.log('--- stranger1 send 10eth ---')
      await web3.eth.sendTransaction({ from: stranger2, to: lido.address, value: ETH(10) })
      // 50% of mintedShares
      await operators.setFee(500, { from: appManager })
      const NORFee = await operators.getFee()
      assertBn(500, NORFee, 'invalid node operator registry fee')
    })

    it(`base functions`, async () => {
      // 50% of mintedShares
      await operators.setFee(500, { from: appManager })

      // add NodeOperatorRegistry
      // name, address, cap, treasuryFee
      await stakingRouter.addModule('Curated', operators.address, proModule.softCap, proModule.treasuryFee, { from: appManager })

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

        console.log(`module ${name} address`, _module.address)

        await stakingRouter.addModule(name, _module.address, module.softCap, module.treasuryFee, { from: appManager })
        await _module.setTotalKeys(module.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(module.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(module.totalStoppedKeys, { from: appManager })

        module.address = _module.address
      }

      await getLidoStats(lido, { Stranger1: externalAddress, Stranger2: stranger2, StakingRouter: stakingRouter.address })

      console.log('after allocation')
      let table = await getModulesInfo(stakingRouter)
      console.table(table)

      await provider.send('hardhat_setBalance', [stakingRouter.address, '0x' + parseInt(ETH(101 * 32)).toString(16)])

      const balance = await web3.eth.getBalance(stakingRouter.address)
      console.log('stakingRouter balance:', y(balance))

      // first distribute
      console.log('Distribute allocation')
      const resp = await stakingRouter.distributeDeposits()

      let alloc = await getAlloc(stakingRouter)
      console.log('allocation1', alloc)
      console.log('last distribute', (await stakingRouter.lastDistributeAt()).toString())

      const modulesCount = await stakingRouter.getModulesCount()
      console.log('Modules count', parseInt(modulesCount))

      const curatedModule = await stakingRouter.getModule(0)
      const communityModule = await stakingRouter.getModule(1)

      const curModule = await NodeOperatorsRegistryMock.at(curatedModule.moduleAddress)
      const comModule = await ModuleSolo.at(communityModule.moduleAddress)

      console.log('Set staking router for modules')
      curModule.setStakingRouter(stakingRouter.address)
      comModule.setStakingRouter(stakingRouter.address)

      const wc = pad('0x0202', 32)
      await lido.setWithdrawalCredentials(wc, { from: voting })
      console.log('Set withdrawal credentials ' + g(wc))

      const keys1 = genKeys(3)
      console.log(b('DEPOSIT 3 keys COMMUNITY module'))
      await comModule.deposit(keys1.pubkeys, keys1.sigkeys)

      const balance_2 = await web3.eth.getBalance(stakingRouter.address)
      console.log('StakingRouter balance:', y(balance_2))

      alloc = await getAlloc(stakingRouter)
      console.log('allocation2', alloc)

      table = await getModulesInfo(stakingRouter)
      console.table(table)

      // update
      console.log('add node operator to curated module')
      await curModule.addNodeOperator('fo o', ADDRESS_1, { from: voting })

      console.log('add keys to node operator curated module')
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

      console.log('increase staking limit to 1000')
      await curModule.setNodeOperatorStakingLimit(0, 1000, { from: voting })

      console.log(b('DEPOSIT 1 key for curated module'))
      await curModule.deposit(1)

      // 3
      alloc = await getAlloc(stakingRouter)
      console.log('\n allocation3', alloc)

      table = await getModulesInfo(stakingRouter)
      console.table(table)

      balance_3 = await web3.eth.getBalance(stakingRouter.address)
      console.log('StakingRouter balance3:', y(balance_3))

      // 4 try to deposit more from cureated module

      // wait 12 hour
      const waitTime = 3600 * 12
      console.log(g('WAIT ', waitTime))

      await ethers.provider.send('evm_increaseTime', [waitTime])
      await ethers.provider.send('evm_mine')

      console.log(b('try to DEPOSIT 3 key for curated module'))
      await curModule.deposit(3)

      alloc = await getAlloc(stakingRouter)
      console.log('\n allocation4', alloc)

      table = await getModulesInfo(stakingRouter)
      console.table(table)

      balance_4 = await web3.eth.getBalance(stakingRouter.address)
      console.log('StakingRouter balance4:', y(balance_4))

      // await stakingRouter.distributeDeposits()
      // console.log('last distribute', (await stakingRouter.lastDistributeAt()).toString())

      // console.log('report oracle 1 eth')
      // await oracle.reportBeacon(100, 0, ETH(1), { from: appManager })

      // await getLidoStats(lido, {Stranger1: externalAddress, Stranger2: stranger2, StakingRouter: stakingRouter.address})

      // const op1 = await ModulePro.at(modules[0].address)

      // const data = {}
      // for (let i = 0; i < modules.length; i++) {
      //   const op = await ModulePro.at(modules[i].address)

      //   const TotalKeys = await op.getTotalKeys()
      //   const UsedKeys = await op.getTotalUsedKeys()
      //   const StoppedKeys = await op.getTotalStoppedKeys()
      //   const WithdrawnKeys = await op.getTotalWithdrawnKeys()
      //   const FreeKeys = TotalKeys.sub(UsedKeys).sub(StoppedKeys).sub(WithdrawnKeys)

      //   data[`Operator${i}`] = {
      //     TotalKeys: TotalKeys.toString(),
      //     UsedKeys: UsedKeys.toString(),
      //     StoppedKeys: StoppedKeys.toString(),
      //     FreeKeys: FreeKeys.toString()
      //   }
      // }
    })

    it(`recycle allocation works`, async () => {
      const stakeModules = [proModule, soloModule, soloModule2]
      const stakeModuleContracts = []

      console.log('add node operator to curated module')
      await operators.addNodeOperator('op1', ADDRESS_1, { from: voting })

      /**
       *
       *  INITIALIZE modules
       *
       */
      for (let i = 0; i < stakeModules.length; i++) {
        const stakeModule = stakeModules[i]
        let _module

        if (stakeModule.type === 0) {
          // skip pro module
          // continue
          _module = operators
        } else {
          // add solo module
          _module = await ModuleSolo.new(stakeModule.type, lido.address, stakeModule.fee, { from: appManager })
        }
        console.log(`module ${stakeModule.name} address`, _module.address)

        await stakingRouter.addModule(stakeModule.name, _module.address, stakeModule.softCap, stakeModule.treasuryFee, {
          from: appManager
        })
        await _module.setTotalKeys(stakeModule.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(stakeModule.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(stakeModule.totalStoppedKeys, { from: appManager })

        await _module.setStakingRouter(stakingRouter.address)
        stakeModule.address = _module.address
        stakeModuleContracts.push(_module)
      }

      console.log('before allocation')
      let recAlloc = await getRecAlloc(stakingRouter)
      let alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })

      console.log('add keys to node operator curated module')
      let keysAmount = 45
      let moduleId = 0
      let keys = genKeys(keysAmount)
      // console.log(keys)
      await operators.addSigningKeys(0, keysAmount, keys.pubkeys, keys.sigkeys, { from: voting })
      console.log('increase staking limit to 11000')
      await operators.setNodeOperatorStakingLimit(0, 11000, { from: voting })

      // await getLidoStats(lido, { Stranger1: externalAddress, Stranger2: stranger2, StakingRouter: stakingRouter.address })

      console.log('simulate balance topup')
      await provider.send('hardhat_setBalance', [stakingRouter.address, '0x' + parseInt(ETH(101 * 32)).toString(16)])

      // first distribute
      console.log('Distribute allocation')
      await provider.send('evm_increaseTime', [3600 * 1 + 10])
      await provider.send('evm_mine')

      await stakingRouter.distributeDeposits()
      console.log('last distribute', (await stakingRouter.lastDistributeAt()).toString())

      // console.log('after allocation')
      // console.table(await getModulesInfo(stakingRouter))

      // wait +6 hours
      console.log(
        'forward +6h after 1st distributeDeposits:\n- module0 idle 6h, no keys, skip recycle;\n- module1 idle 6h, skip recycle;\n- module2 idle 6h, skip recycle'
      )

      await provider.send('evm_increaseTime', [3600 * 6 + 10])
      await provider.send('evm_mine')

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })
      assert.equal(recAlloc.totalRecycleKeys, 0)
      assert.deepEqual(recAlloc.levels, [0, 0, 0])
      assert.deepEqual(recAlloc.keysAmounts, [0, 0, 0])
      assert.deepEqual(alloc, [0, 51, 50])

      keysAmount = 3
      moduleId = 1
      keys = genKeys(keysAmount)
      console.log(`===> deposit: Module #${moduleId}, keys: ${keysAmount}`)
      await stakeModuleContracts[moduleId].deposit(keys.pubkeys, keys.sigkeys)

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })
      assert.equal(recAlloc.totalRecycleKeys, 0)
      assert.deepEqual(recAlloc.levels, [0, 0, 0])
      assert.deepEqual(recAlloc.keysAmounts, [0, 0, 0])
      assert.deepEqual(alloc, [0, 48, 50])

      // wait +6 hours, 50% of keys avail to recycle
      console.log(
        'forward +12h after 1st distributeDeposits:\n- module0 idle 12h, no keys, skip recycle;\n- module1 idle 6h (after deposit), skip recycle;\n- module2 idle 12h, 50% recycle'
      )

      await provider.send('evm_increaseTime', [3600 * 6 + 10])
      await provider.send('evm_mine')

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })

      assert.equal(recAlloc.totalRecycleKeys, 25)
      assert.deepEqual(recAlloc.levels, [0, 0, 1])
      assert.deepEqual(recAlloc.keysAmounts, [0, 0, 25])
      assert.deepEqual(alloc, [0, 48, 50])

      // at this point module1 is 'good' because it's last deposit was 6h ago
      let expectedMaxKeys = [
        { allocKeysAmount: 0, recycledKeysAmount: 25 }, // min(totalKeys-usedKeys, 50% keys of module1+module2)
        { allocKeysAmount: 48, recycledKeysAmount: 25 }, // 50% keys of module 2 + module 0
        { allocKeysAmount: 50, recycledKeysAmount: 0 } // 50% keys of module 1 + module 0
      ]
      for (let i = 0; i < stakeModules.length; i++) {
        const { allocKeysAmount, recycledKeysAmount } = await stakingRouter.getModuleMaxKeys(i)
        assert.equal(allocKeysAmount, expectedMaxKeys[i].allocKeysAmount)
        assert.equal(recycledKeysAmount, expectedMaxKeys[i].recycledKeysAmount)
        // console.log({ i, allocKeysAmount: allocKeysAmount.toNumber(), recycledKeysAmount: recycledKeysAmount.toNumber() })
      }

      keysAmount = 20
      moduleId = 0
      console.log(`===> deposit: Module #${moduleId}, keys: ${keysAmount}`)
      await stakeModuleContracts[moduleId].deposit(keysAmount)

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })
      assert.equal(recAlloc.totalRecycleKeys, 5)
      assert.deepEqual(recAlloc.levels, [0, 0, 1])
      assert.deepEqual(recAlloc.keysAmounts, [0, 0, 5])
      assert.deepEqual(alloc, [0, 48, 30])

      console.log(
        'forward +15h after 1st distributeDeposits:\n- module0 idle 3h, no keys, skip recycle;\n- module1 idle 9h (after deposit), skip recycle;\n- module2 idle 15h, 75% recycle'
      )

      await provider.send('evm_increaseTime', [3600 * 3 + 10])
      await provider.send('evm_mine')

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })
      assert.equal(recAlloc.totalRecycleKeys, 22)
      assert.deepEqual(recAlloc.levels, [0, 0, 2])
      assert.deepEqual(recAlloc.keysAmounts, [0, 0, 22])

      expectedMaxKeys = [
        { allocKeysAmount: 0, recycledKeysAmount: 22 }, // 75% keys of module 2
        { allocKeysAmount: 48, recycledKeysAmount: 22 }, // 75% keys of module 2
        { allocKeysAmount: 30, recycledKeysAmount: 0 } // no recycle here due to: module 1 has deposited 9h ago, and mod 0 have no allocation
      ]
      for (let i = 0; i < stakeModules.length; i++) {
        const { allocKeysAmount, recycledKeysAmount } = await stakingRouter.getModuleMaxKeys(i)
        assert.equal(allocKeysAmount, expectedMaxKeys[i].allocKeysAmount)
        assert.equal(recycledKeysAmount, expectedMaxKeys[i].recycledKeysAmount)
      }

      console.log(
        'forward +18h after 1st distributeDeposits:\n- module0 idle 6h, no keys, skip recycle;\n- module1 idle 12h (after deposit), 50% recycle;\n- module2 idle 18h, 100% recycle'
      )

      await provider.send('evm_increaseTime', [3600 * 3 + 10])
      await provider.send('evm_mine')

      recAlloc = await getRecAlloc(stakingRouter)
      alloc = await getAlloc(stakingRouter)
      console.table(await getModulesInfo(stakingRouter))
      console.table({ recAlloc, alloc })
      assert.equal(recAlloc.totalRecycleKeys, 54)
      assert.deepEqual(recAlloc.levels, [0, 1, 3])
      assert.deepEqual(recAlloc.keysAmounts, [0, 24, 30])

      expectedMaxKeys = [
        { allocKeysAmount: 0, recycledKeysAmount: 26 }, // totalKeys-usedKeys < 100% recycle keys of module2+ 50% keys of module 1)
        { allocKeysAmount: 48, recycledKeysAmount: 30 }, // 100% keys of mod 2
        { allocKeysAmount: 30, recycledKeysAmount: 24 } // 50% keys of module 1
      ]
      for (let i = 0; i < stakeModules.length; i++) {
        const { allocKeysAmount, recycledKeysAmount } = await stakingRouter.getModuleMaxKeys(i)
        // console.log({ i, allocKeysAmount, recycledKeysAmount })
        assert.equal(allocKeysAmount, expectedMaxKeys[i].allocKeysAmount)
        assert.equal(recycledKeysAmount, expectedMaxKeys[i].recycledKeysAmount)
      }
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

  console.table(data)
}

function g(val) {
  return chalk.green(val)
}
function b(val) {
  return chalk.blue(val)
}
function y(val) {
  return chalk.yellow(val)
}

async function getAlloc(stakingRouter) {
  const alloc = []
  const modulesCount = await stakingRouter.getModulesCount()
  for (let i = 0; i < modulesCount; i++) {
    alloc.push(parseInt(await stakingRouter.allocation(i)))
  }

  return alloc
}

async function getRecAlloc(stakingRouter) {
  const recAlloc = {}
  const modulesCount = await stakingRouter.getModulesCount()
  const _recAlloc = await stakingRouter.getRecycleAllocation()

  recAlloc.totalRecycleKeys = +_recAlloc.totalRecycleKeys
  recAlloc.levels = []
  recAlloc.keysAmounts = []
  for (let i = 0; i < modulesCount; i++) {
    recAlloc.levels.push(+_recAlloc.levels[i])
    recAlloc.keysAmounts.push(+_recAlloc.keysAmounts[i])
  }

  return recAlloc
}

async function getModulesInfo(stakingRouter) {
  const modulesCount = await stakingRouter.getModulesCount()
  const table = []
  for (let i = 0; i < modulesCount; i++) {
    const comModule = await stakingRouter.getModule(i)
    const entry = await IStakingModule.at(comModule.moduleAddress)

    table.push({
      name: comModule.name,
      cap: +comModule.cap,
      fee: +(await entry.getFee()),
      treasuryFee: parseInt(comModule.treasuryFee),
      paused: comModule.paused,
      active: comModule.active,
      lastDepositAt: +comModule.lastDepositAt,
      recycleAt: +comModule.recycleAt,
      recycleLevel: +comModule.recycleLevel,
      recycleRestAmount: +comModule.recycleRestAmount,

      totalKeys: +(await entry.getTotalKeys()),
      totalUsedKeys: +(await entry.getTotalUsedKeys()),
      totalStoppedKeys: +(await entry.getTotalStoppedKeys())
      // totalExitedKeys: +(await entry.getTotalExitedKeys())
    })
  }

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
