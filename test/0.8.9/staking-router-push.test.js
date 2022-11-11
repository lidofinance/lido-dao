const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')

const StakingRouter = artifacts.require('StakingRouter.sol')
const ModulePro = artifacts.require('ModulePro.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
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
  type: 0, // PRO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 4000,
  totalUsedKeys: 3000,
  totalStoppedKeys: 100,
  softCap: 0,
  assignedDeposits: 0,
  balance: 0
}

const soloModule = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 100,
  totalUsedKeys: 10,
  totalStoppedKeys: 1,
  softCap: 9000,
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}

const soloModule2 = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 200,
  totalUsedKeys: 20,
  totalStoppedKeys: 1,
  softCap: 100,
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}
const soloModule3 = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 1000,
  totalUsedKeys: 1000,
  totalStoppedKeys: 100,
  softCap: 100,
  assignedDeposits: 0,
  bond: 20,
  balance: 0
}

const ModuleTypes = ['PRO', 'SOLO', 'DVT']

const modules = []
modules.push(proModule)
modules.push(soloModule)
modules.push(soloModule2)
modules.push(soloModule3)

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
    console.table(modules)
  })

  beforeEach(async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new({ from: deployer })

    const daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(lido.address)

    // Init the BURN_ROLE role and assign in to voting
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    stakingRouter = await StakingRouter.new(lido.address, depositContract.address, { from: appManager })

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
    })

    it(`init counters and burn amount per run works`, async () => {
      /**
       *
       *
       *  INITIALIZE modules
       *
       *
       *
       */
      for (i = 0; i < modules.length; i++) {
        const module = modules[i]
        let _module

        // add pro module
        if (module.type === 0) {
          _module = await ModulePro.new(module.type, lido.address, module.fee, module.treasuryFee, { from: appManager })
          // add solo module
        } else if (module.type === 1) {
          _module = await ModuleSolo.new(module.type, lido.address, module.fee, module.treasuryFee, module.bond, { from: appManager })
        }

        const name = ModuleTypes[module.type] + i

        await stakingRouter.addStakingModule(name, _module.address, module.softCap, { from: appManager })
        await _module.setTotalKeys(module.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(module.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(module.totalStoppedKeys, { from: appManager })

        module.address = _module.address
      }

      let total = await lido.totalSupply()
      let shares = await lido.getTotalShares()

      console.log('--- before ---')
      console.log('lido balance', total.toString())
      console.log('lido shares', shares.toString())

      const b1 = await lido.balanceOf(externalAddress)
      console.log('b1', b1.toString())

      console.log('report oracle 1 eth')
      await oracle.reportBeacon(100, 0, ETH(1), { from: appManager })

      total = await lido.totalSupply()
      shares = await lido.getTotalShares()
      console.log('--- after report ---')
      console.log('lido balance', total.toString())
      console.log('lido shares', shares.toString())

      console.log('modulesCount', (await stakingRouter.modulesCount()).toString())

      assertBn(await stakingRouter.modulesCount(), modules.length)

      /**
       *
       * DISTRIBUTE REWARDS (push based)
       *
       */
      await stakingRouter.distributeRewards(ETH(1), { from: appManager })

      const strangerBalance = await lido.balanceOf(externalAddress)
      console.log('strangerBalance', strangerBalance.toString())

      const stranger2Balance = await lido.balanceOf(stranger2)
      console.log('stranger2Balance', stranger2Balance.toString())

      for (i = 0; i < modules.length; i++) {
        const module = modules[i]
        const balance = await lido.balanceOf(module.address)
        module.balance = balance.toString()
      }

      console.table(modules)

      total = await lido.totalSupply()
      shares = await lido.getTotalShares()
      console.log('lido balance', total.toString())
      console.log('lido shares', shares.toString())

      console.log('--- deposit new keys ---')
      console.time()
      let deposits = await stakingRouter.getModulesDeposits(3)
      console.timeEnd()

      let deps = []
      for (i = 0; i < deposits.length; i++) {
        deps[i] = {
          totalKeys: deposits[i].totalKeys.toString(),
          totalUsedKeys: deposits[i].totalUsedKeys.toString(),
          totalStoppedKeys: deposits[i].totalStoppedKeys.toString(),
          assignedKeys: deposits[i].assignedKeys.toString(),
          softCap: deposits[i].softCap.toString()
        }
      }
      console.table(deps)

      const op1 = await ModulePro.at(modules[0].address)
      const op1totalKeys = await op1.totalKeys()
      let active = await op1.getActiveNodeOperatorsCount()
      console.log('total keys', op1totalKeys.toString())
      console.log('total active', active.toString())

      const tx2 = await op1.addNodeOperator('fo o', ADDRESS_1, { from: appManager })
      await op1.setNodeOperatorStakingLimit(0, 10, { from: appManager })

      keysAssignedEvt = getEventAt(tx2, 'NodeOperatorAdded').args
      // console.log(keysAssignedEvt)

      active = await op1.getActiveNodeOperatorsCount()
      console.log('total active', active.toString())

      const op0 = {
        keys: [pad('0xaa0101', 48), pad('0xaa0202', 48), pad('0xaa0303', 48)],
        sigs: [pad('0xa1', 96), pad('0xa2', 96), pad('0xa3', 96)]
      }

      await op1.addSigningKeys(0, 3, hexConcat(...op0.keys), hexConcat(...op0.sigs), { from: appManager })

      active = await op1.getActiveNodeOperatorsCount()
      console.log('total active', active.toString())

      // result = await op1.assignNextSigningKeys(1)
      const tx3 = await stakingRouter.distributeDeposits(1000)
      keysAssignedEvt = getEventAt(tx3, 'KeysAssigned').args

      active = await op1.getActiveNodeOperatorsCount()
      console.log('total active', active.toString())

      // console.log(keysAssignedEvt)

      deposits = await stakingRouter.getModulesDeposits(3)

      deps = []
      for (i = 0; i < deposits.length; i++) {
        deps[i] = {
          totalKeys: deposits[i].totalKeys.toString(),
          totalUsedKeys: deposits[i].totalUsedKeys.toString(),
          totalStoppedKeys: deposits[i].totalStoppedKeys.toString(),
          assignedKeys: deposits[i].assignedKeys.toString(),
          softCap: deposits[i].softCap.toString()
        }
      }
      console.table(deps)
    })
  })
})
