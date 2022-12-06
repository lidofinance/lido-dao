const chalk = require('chalk')

const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')

const StakingRouter = artifacts.require('StakingRouter.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')
const IModule = artifacts.require('contracts/0.4.24/interfaces/IModule.sol:IModule')

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
  softCap: 0,
  assignedDeposits: 0,
  balance: 0,

  totalKeys: 100000,
  totalUsedKeys: 40000,
  totalStoppedKeys: 0
}

const soloModule = {
  name: 'Community',

  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  softCap: 100,
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

      // 50% of mintedShares
      await operators.setFee(500, { from: appManager })

      // add NodeOperatorRegistry
      // name, address, cap, treasuryFee
      await stakingRouter.addModule('Curated', operators.address, 0, 500, { from: appManager })

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
      for (i = 0; i < modules.length; i++) {
        const module = modules[i]
        let _module

        // add pro module
        if (module.type === 0) {
          continue;
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

      await ethers.provider.send('hardhat_setBalance', [stakingRouter.address, '0x' + parseInt(ETH(101 * 32)).toString(16)])

      const balance = await web3.eth.getBalance(stakingRouter.address)
      console.log('stakingRouter balance:', y(balance))

      // first distribute
      console.log('Distribute allocation')
      const resp = await stakingRouter.distributeDeposits()

      let alloc = await getAlloc(stakingRouter)
      console.log('allocation1', alloc)
      console.log('last distribute', (await stakingRouter.lastDistribute()).toString())

      const modulesCount = await stakingRouter.getModulesCount()
      console.log('Modules count', parseInt(modulesCount))

      curatedModule = await stakingRouter.getModule(0)
      communityModule = await stakingRouter.getModule(1)

      const curModule = await NodeOperatorsRegistryMock.at(curatedModule.moduleAddress)
      const comModule = await ModuleSolo.at(communityModule.moduleAddress)

      console.log('Set staking router for modules')
      curModule.setStakingRouter(stakingRouter.address)
      comModule.setStakingRouter(stakingRouter.address)

      const wc = pad('0x0202', 32)
      await lido.setWithdrawalCredentials(wc, { from: voting })
      console.log('Set withdrawal credentials ' + g(wc))

      // deposit(pubkey, sig)
      const pubkeys1 = hexConcat(pad('0x0101', 48), pad('0x0102', 48), pad('0x0103', 48))
      const sigkeys1 = hexConcat(pad('0x0101', 96), pad('0x0102', 96), pad('0x0103', 96))

      console.log(b('DEPOSIT 3 keys COMMUNITY module'))
      await comModule.deposit(pubkeys1, sigkeys1)

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
        await curModule.addSigningKeys(0, 1, pad('0x010203', 48), pad('0x01', 96), { from: voting })
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
      await ethers.provider.send('evm_increaseTime', [3600 * 12])
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
      // console.log('last distribute', (await stakingRouter.lastDistribute()).toString())

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
  const allocation_0 = await stakingRouter.allocation(0)
  const allocation_1 = await stakingRouter.allocation(1)
  alloc.push(parseInt(allocation_0))
  alloc.push(parseInt(allocation_1))

  return alloc
}

async function getModulesInfo(stakingRouter) {
  let modulesCount = await stakingRouter.getModulesCount()
  let table = {}
  for (i = 0; i < modulesCount; i++) {
    let module = await stakingRouter.getModule(i)
    const entry = await IModule.at(module.moduleAddress)

    table[modules[i].name] = {
      name: module.name,
      cap: parseInt(module.cap),
      fee: parseInt(await entry.getFee()),
      treasuryFee: parseInt(module.treasuryFee),
      paused: module.paused,
      active: module.active,

      totalKeys: parseInt(await entry.getTotalKeys()),
      totalUsedKeys: parseInt(await entry.getTotalUsedKeys()),
      totalStoppedKeys: parseInt(await entry.getTotalStoppedKeys()),
      totalExitedKeys: parseInt(await entry.getTotalExitedKeys())
    }
  }

  return table
}
