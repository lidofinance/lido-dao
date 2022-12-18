const chalk = require('chalk')
const { log, logSplitter, logWideSplitter, logHeader, logTable, yl, bl, gr, rd, OK, NOT_OK, logTx } = require('../../scripts/helpers/log')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument, isBn, MAX_UINT256 } = require('@aragon/contract-helpers-test')
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
  recycleShare: 0, // 0%, no effect if targetShare >=10000
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
  recycleShare: 5000, // 50% of targetShare
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
  recycleShare: 10000, // +100% of targetShare
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 100,
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

    await stakingRouter.grantRole(MANAGE_WITHDRAWAL_KEY_ROLE, voting, { from: appManager })
    await stakingRouter.grantRole(MODULE_PAUSE_ROLE, voting, { from: appManager })
    await stakingRouter.grantRole(MODULE_CONTROL_ROLE, voting, { from: appManager })

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
      await web3.eth.sendTransaction({ from: externalAddress, to: lido.address, value: ETH(20) })
      log('--- stranger1 send 10eth ---')
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
      await stakingRouter.addModule('Curated', operators.address, proModule.targetShare, proModule.recycleShare, proModule.treasuryFee, {
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

        await stakingRouter.addModule(name, _module.address, module.targetShare, module.recycleShare, module.treasuryFee, {
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
      logTable(table)

      await provider.send('hardhat_setBalance', [stakingRouter.address, '0x' + parseInt(ETH(101 * 32)).toString(16)])

      const balance = await web3.eth.getBalance(stakingRouter.address)
      log('stakingRouter balance:', yl(balance))

      // const { cache, newTotalAllocation } = await stakingRouter.getAllocation(10)
      // log({ newTotalAllocation, cache })
      // first distribute
      logWideSplitter(bl(`call distributeDeposits()`))
      await stakingRouter.distributeDeposits()
      log(OK, `- ${gr('NO revert')}!`)

      const alloc = await getAndCheckAlloc(stakingRouter)
      log('allocation1', alloc.assignedKeys)
      log('last distribute', (await stakingRouter.getLastDistributeAt()).toString())

      const modulesCount = await stakingRouter.getModulesCount()
      log('Modules count', parseInt(modulesCount))

      const curatedModule = await stakingRouter.getModule(0)
      const communityModule = await stakingRouter.getModule(1)

      const curModule = await NodeOperatorsRegistryMock.at(curatedModule.moduleAddress)
      const comModule = await ModuleSolo.at(communityModule.moduleAddress)

      log('Set staking router for modules')
      curModule.setStakingRouter(stakingRouter.address)
      comModule.setStakingRouter(stakingRouter.address)

      const keys1 = genKeys(3)
      log(bl('DEPOSIT 3 keys COMMUNITY module'))
      await comModule.deposit(keys1.pubkeys, keys1.sigkeys)

      const balance_2 = await web3.eth.getBalance(stakingRouter.address)
      log('StakingRouter balance:', yl(balance_2))

      await getAndCheckAlloc(stakingRouter)
      log('allocation2', alloc.assignedKeys)

      table = await getModulesInfo(stakingRouter)
      logTable(table)

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

      log(bl('DEPOSIT 1 key for curated module'))
      await curModule.deposit(1)

      // 3
      await getAndCheckAlloc(stakingRouter)
      log('\n allocation3', alloc.assignedKeys)

      table = await getModulesInfo(stakingRouter)
      logTable(table)

      balance_3 = await web3.eth.getBalance(stakingRouter.address)
      log('StakingRouter balance3:', yl(balance_3))

      // 4 try to deposit more from cureated module

      // wait 12 hour
      const waitTime = 3600 * 12
      log(gr('WAIT ', waitTime))

      await ethers.provider.send('evm_increaseTime', [waitTime])
      await ethers.provider.send('evm_mine')

      log(bl('try to DEPOSIT 3 key for curated module'))
      await curModule.deposit(3)

      await getAndCheckAlloc(stakingRouter)
      log('\n allocation4', alloc.assignedKeys)

      table = await getModulesInfo(stakingRouter)
      logTable(table)

      balance_4 = await web3.eth.getBalance(stakingRouter.address)
      log('StakingRouter balance4:', yl(balance_4))

      // logWideSplitter(bl('call distributeDeposits() - should NOT revert!!'))
      // await stakingRouter.distributeDeposits()
      // log('last distribute', (await stakingRouter.lastDistributeAt()).toString())

      // log('report oracle 1 eth')
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

      log('add node operator to curated module')
      await operators.addNodeOperator('op1', ADDRESS_1, { from: voting })
      let totalAllocation = 0
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
        log(`module ${stakeModule.name} address`, yl(_module.address))

        await stakingRouter.addModule(
          stakeModule.name,
          _module.address,
          stakeModule.targetShare,
          stakeModule.recycleShare,
          stakeModule.treasuryFee,
          {
            from: voting
          }
        )
        await _module.setTotalKeys(stakeModule.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(stakeModule.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(stakeModule.totalStoppedKeys, { from: appManager })

        await _module.setStakingRouter(stakingRouter.address)
        stakeModule.address = _module.address
        stakeModuleContracts.push(_module)
        totalAllocation += stakeModule.totalUsedKeys - stakeModule.totalStoppedKeys
      }
      log({ totalAllocation })

      log('add keys to node operator curated module')
      let keysAmount = 50
      let moduleId = 0
      let keys = genKeys(keysAmount)
      // log(keys)
      await operators.addSigningKeys(0, keysAmount, keys.pubkeys, keys.sigkeys, { from: voting })
      await operators.addSigningKeys(0, keysAmount, keys.pubkeys, keys.sigkeys, { from: voting })
      log('increase staking limit for pro module')
      await operators.setNodeOperatorStakingLimit(0, 15000, { from: voting })

      // await getLidoStats(lido, { Stranger1: externalAddress, Stranger2: stranger2, StakingRouter: stakingRouter.address })

      log('simulate balance topup')
      const depositsAmount = 101
      await provider.send('hardhat_setBalance', [stakingRouter.address, '0x' + parseInt(ETH(depositsAmount * 32)).toString(16)])

      logHeader('+1h 1st distributeDeposits')
      await provider.send('evm_increaseTime', [3600 * 1 + 10])
      await provider.send('evm_mine')

      // before allocation
      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 0, 0] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 0,

        recycleKeys: [0, 0, 0]
      })

      // first distribute
      logWideSplitter()
      await logTx(bl('call distributeDeposits()'), stakingRouter.distributeDeposits())
      log(OK, `- ${gr('NO revert')}!`)
      const lastDistributeAt = (await stakingRouter.getLastDistributeAt()).toNumber()
      log('last distribute', lastDistributeAt)

      // after allocation
      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 16, 85] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 0,
        recycleKeys: [0, 0, 0]
      })

      // wait +6 hours
      logHeader('forward +6h after 1st distributeDeposits')
      log('- module0 idle 6h, no keys, skip recycle;\n- module1 idle 6h, skip recycle;\n- module2 idle 6h, skip recycle')

      await provider.send('evm_increaseTime', [3600 * 6 + 10])
      await provider.send('evm_mine')

      // depositsAmount = (balance / 32) = 101
      // curAllocation[i] = totalUsedKeys[i] - totalStoppedKeys[i]
      // curAllocation[0] = 9998 - 0 = 9998
      // curAllocation[1] = 80 - 10 = 70
      // curAllocation[2] = 0 - 0 = 0
      // curTotalAllocation = ∑ curAllocation[i] = 9998 + 70 + 0 = 10068
      // newTotalAllocation = curTotalAllocation + depositsAmount = 10068 + 101 = 10169

      // maxAssignedKeys[i] = min(newTotalAllocation * targetShare[i], totalUsedKeys[i]) - curAllocation[i]
      // maxAssignedKeys[0] = min(10169 * 1, 9999) - 9998 = min(10169,10099) - 9998 = 101
      // maxAssignedKeys[1] = min(10169 * 0.01, 300) - 70 = min(101,300) - 70 = 32
      // maxAssignedKeys[2] = min(10169 * 0.02, 100) - 0 = min(202,100) - 0 = 100
      // 1st iteration: lowest stake has module[2], so at least 70 keys will be assigned to be equal to module[1]
      // 2nd iteration: rest (101 - 70) = 31 keys divided between module[1] (+15) and  module[2] (+15), reminder goes to module[1] (+1) as it has lower index
      // assignedKeys[0] = 0
      // assignedKeys[1] = 15 + 1 = 16
      // assignedKeys[2] = 70 + 15 = 85
      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 16, 85] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 0,
        recycleKeys: [0, 0, 0]
      })

      keysAmount = 10
      moduleId = 1
      keys = genKeys(keysAmount)

      logWideSplitter()
      await logTx(
        bl(`call deposit(): Module #${moduleId}, keys: ${keysAmount}`),
        stakeModuleContracts[moduleId].deposit(keys.pubkeys, keys.sigkeys)
      )

      await getModulesInfo(stakingRouter)
      // assignedKeys[1] = 16 - 3(deposited) = 13
      alloc = await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 6, 85] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 0,
        recycleKeys: [0, 0, 0]
      })

      // wait +6 hours, 50% of keys avail to recycle
      logHeader('forward +12h after 1st distributeDeposits')
      log('- module0 idle 12h, no keys, skip recycle;\n- module1 idle 6h (after deposit), skip recycle;\n- module2 idle 12h, 100% recycle')

      await provider.send('evm_increaseTime', [3600 * 6 + 10])
      await provider.send('evm_mine')

      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 6, 85] })

      // recycledKeys[0] = 0, it doesn't have any allocation
      // recycledKeys[1] = 0, less than 12h pass since module deposited
      // recycledKeys[2] = 100% of 85 = 85
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 85,
        recycleKeys: [0, 0, 85]
      })

      // at this point module1 is 'good' because it's last deposit was 6h ago
      // hardCap = newTotalAllocation * targetShare * ( 1 + recycleShare) - usedKeys - assignedKeys
      // hardCap[1] = 10169 * 0.01 * 1.5 - 90 - 6 = 152 - 90 - 6 = 56
      await getAndCheckMaxKeys(stakingRouter, stakeModules, [
        { assignedKeys: 0, recycledKeys: 85 }, // min(totalKeys-usedKeys, 100% keys of module1+module2)
        { assignedKeys: 6, recycledKeys: 56 }, // 100% keys of module 2 + module 0, but no more than hardCap
        { assignedKeys: 85, recycledKeys: 0 } // 100% keys of module 1 + module 0
      ])

      logWideSplitter(bl('call distributeDeposits()...'))
      const revertReason = 'allocation not changed'
      // distribution should not be changed !!!
      await assertRevert(stakingRouter.distributeDeposits(), revertReason)
      log(OK, `- ${rd('revert')}!, reason: ${yl(revertReason)}`)

      await getModulesInfo(stakingRouter)
      // await getAndCheckAlloc(stakingRouter, { assignedKeys:  [0, 13, 85]})
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 6, 85] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 85,
        recycleKeys: [0, 0, 85]
      })

      assert.equal((await stakingRouter.getLastDistributeAt()).toNumber(), lastDistributeAt)

      keysAmount = 25
      moduleId = 0
      logSplitter()
      // woarkaround to not increase block baseFee during the tests
      await logTx(bl(`call deposit(): Module #${moduleId}, keys: ${keysAmount}`), stakeModuleContracts[moduleId].deposit(keysAmount))
      await logTx(bl(`call deposit(): Module #${moduleId}, keys: ${keysAmount}`), stakeModuleContracts[moduleId].deposit(keysAmount))
      await logTx(bl(`call deposit(): Module #${moduleId}, keys: ${keysAmount}`), stakeModuleContracts[moduleId].deposit(keysAmount))

      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 6, 10] }) // recycled keys are subtracted from module[2] allocation
      // module[0] deposited 75 keys which will be taken from module[2]
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 10, // 85 - 75
        recycleKeys: [0, 0, 10]
      })

      logWideSplitter(bl('call distributeDeposits()...'))
      // distribution should not be changed !!!
      await assertRevert(stakingRouter.distributeDeposits(), revertReason)
      log(OK, `- ${rd('revert')}!, reason: ${yl(revertReason)}`)

      logHeader('forward +18h after 1st distributeDeposits')
      log('- module0 idle 6h, no keys, skip recycle;\n- module1 idle 12h (after deposit), 100% recycle;\n- module2 idle 18h, 100% recycle')

      await provider.send('evm_increaseTime', [3600 * 6 + 10])
      await provider.send('evm_mine')

      await getModulesInfo(stakingRouter)
      await getAndCheckAlloc(stakingRouter, { assignedKeys: [0, 6, 10] })
      await getAndCheckRecAlloc(stakingRouter, {
        totalRecycleKeys: 16,
        recycleKeys: [0, 6, 10]
      })

      await getAndCheckMaxKeys(stakingRouter, stakeModules, [
        { assignedKeys: 0, recycledKeys: 16 }, // totalKeys-usedKeys < 100% recycle keys of module2+ 100% keys of module 1)
        { assignedKeys: 6, recycledKeys: 10 }, // 100% keys of mod 2
        { assignedKeys: 10, recycledKeys: 6 } // 100% keys of module 1
      ])
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

async function getAndCheckRecAlloc(stakingRouter, recAllocCheck = undefined) {
  const recAlloc = {}
  const modulesCount = await stakingRouter.getModulesCount()
  const _recAlloc = await stakingRouter.getRecycleAllocation()

  recAlloc.totalRecycleKeys = +_recAlloc.totalRecycleKeys
  recAlloc.recycleKeys = []
  for (let i = 0; i < modulesCount; i++) {
    recAlloc.recycleKeys.push(+_recAlloc.recycleKeys[i])
  }
  log('>>> Recycle allocation <<<')
  logTable(recAlloc)
  if (recAllocCheck) {
    const { totalRecycleKeys, recycleKeys } = recAllocCheck
    assert.equal(recAlloc.totalRecycleKeys, totalRecycleKeys)
    assert.deepEqual(recAlloc.recycleKeys, recycleKeys)
  }
  return recAlloc
}
async function getAndCheckMaxKeys(stakingRouter, stakeModules = [], maxKeysCheck = undefined) {
  const maxKeys = []
  for (let i = 0; i < stakeModules.length; i++) {
    const moduleMaxKeys = await stakingRouter.getModuleMaxKeys(i)
    maxKeys.push({ assignedKeys: +moduleMaxKeys.assignedKeys, recycledKeys: +moduleMaxKeys.recycledKeys })
  }
  log('>>> Module`s max keys <<<')
  logTable(maxKeys)

  if (maxKeysCheck) {
    for (let i = 0; i < stakeModules.length; i++) {
      const { assignedKeys, recycledKeys } = maxKeysCheck[i]
      assert.equal(maxKeys[i].assignedKeys, assignedKeys)
      assert.equal(maxKeys[i].recycledKeys, recycledKeys)
    }
  }
  return maxKeys
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
      recycleShare: +comModule.recycleShare,
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
