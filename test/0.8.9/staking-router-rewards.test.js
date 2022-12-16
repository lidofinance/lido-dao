const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')

const StakingRouter = artifacts.require('StakingRouter.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')
const IStakingModule = artifacts.require('contracts/0.4.24/interfaces/IStakingModule.sol:IStakingModule')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')
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
const curatedModule = {
  type: 0, // Curated
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 100,
  totalUsedKeys: 50,
  totalStoppedKeys: 100,
  targetShare: 10000,
  recycleShare: 0, // 0%, no effect if targetShare >=10000
  assignedDeposits: 0,
  balance: 0
}

const communityModule = {
  type: 1, // Community
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 100,
  totalUsedKeys: 30,
  totalStoppedKeys: 1,
  targetShare: 9000,
  recycleShare: 1000, // 10%, no effect if targetShare >=10000
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}

const communityModule2 = {
  type: 1, // Community
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 100,
  totalUsedKeys: 20,
  totalStoppedKeys: 1,
  targetShare: 100,
  recycleShare: 1000, // 10%, no effect if targetShare >=10000
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}
const communityModule3 = {
  type: 1, // Community
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 1000,
  totalUsedKeys: 1000,
  totalStoppedKeys: 100,
  targetShare: 100,
  recycleShare: 1000, // 10%, no effect if targetShare >=10000
  assignedDeposits: 0,
  bond: 20,
  balance: 0
}

const ModuleTypes = ['Curated', 'Community', 'DVT']

const modules = []
modules.push(communityModule)
modules.push(communityModule2)
// modules.push(communityModule3)

contract('StakingRouter', (accounts) => {
  let oracle, lido, burner
  let treasuryAddr
  let insuranceAddr
  let dao, acl, operators

  let stakingRouter

  var appManager = accounts[0]
  var voting = accounts[1]
  var deployer = accounts[2]
  var externalAddress = accounts[3]
  var stranger1 = accounts[4]
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

    // Init the BURN_ROLE role and assign in to voting
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    insuranceAddr = await lido.getInsuranceFund()
    treasuryAddr = await lido.getTreasury()

    console.log('insuranceAddr', insuranceAddr)
    console.log('treasuryAddr', treasuryAddr)

    await oracle.setPool(lido.address)
    await depositContract.reset()

    stakingRouter = await StakingRouter.new(lido.address, depositContract.address, { from: appManager })

    // set staking router to lido
    await lido.setStakingRouter(stakingRouter.address)

    //
    // const receipt = await lido.setProtocolContracts(await app.getOracle(), await app.getTreasury(), user1, { from: voting })

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
      console.log('--- stranger2 send 10eth ---')
      await web3.eth.sendTransaction({ from: stranger2, to: lido.address, value: ETH(10) })
    })

    it(`init counters and burn amount per run works`, async () => {
      // 50% of mintedShares
      await operators.setFee(500, { from: appManager })

      // add NodeOperatorRegistry
      // name, address, cap, treasuryFee
      await stakingRouter.addModule('Curated', operators.address, 10000, 0, 500, { from: appManager })

      await operators.setTotalKeys(curatedModule.totalKeys, { from: appManager })
      await operators.setTotalUsedKeys(curatedModule.totalUsedKeys, { from: appManager })
      await operators.setTotalStoppedKeys(curatedModule.totalStoppedKeys, { from: appManager })

      const NORFee = await operators.getFee()
      assertBn(500, NORFee, 'invalid node operator registry fee')

      /**
       *
       *
       *  INITIALIZE modules
       *
       *
       *
       */
      const addresses = []
      for (i = 0; i < modules.length; i++) {
        const module = modules[i]
        let _module

        // skip pro module
        if (module.type === 0) {
          continue
          // _module = await ModulePro.new(module.type, lido.address, module.fee, module.treasuryFee, { from: appManager })
          // add solo module
        } else if (module.type === 1) {
          _module = await ModuleSolo.new(module.type, lido.address, module.fee, { from: appManager })
        }

        const name = 'Community' + i

        await stakingRouter.addModule(name, _module.address, module.targetShare, module.recycleShare, module.treasuryFee, {
          from: appManager
        })
        await _module.setTotalKeys(module.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(module.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(module.totalStoppedKeys, { from: appManager })

        module.address = _module.address
        addresses[name] = module.address
      }

      console.table(addresses)

      await stakingRouterStats(stakingRouter)

      /**
       * print lido stats
       */
      await getLidoStats(lido, {
        Treasury: await lido.getTreasury(),
        Stranger1: externalAddress,
        Stranger2: stranger2,
        StakingRouter: stakingRouter.address,
        ...addresses
      })

      /**
       *
       * REPORT ORACLE 1ETH rewards
       *
       */
      console.log('report oracle 1 eth')
      const result = await oracle.reportBeacon(100, 0, ETH(1), { from: appManager })

      const sharesTable = await stakingRouter.getSharesTable()
      const recipients = sharesTable.recipients
      const modulesShares = sharesTable.modulesShares
      const moduleFee = sharesTable.moduleFee
      const treasuryFee = sharesTable.treasuryFee
      const res = []
      for (let i = 0; i < recipients.length; i++) {
        console.log(i)
        res.push({
          address: recipients[i],
          modulesShares: parseInt(modulesShares[i]),
          moduleFee: parseInt(moduleFee[i]),
          treasuryFee: parseInt(treasuryFee[i])
        })
      }
      console.table(res)

      // 341770 without
      // 350708
      console.log('gas', result.receipt.gasUsed)

      /**
       * stats after rebase
       */
      await getLidoStats(lido, {
        Treasury: await lido.getTreasury(),
        Stranger1: externalAddress,
        Stranger2: stranger2,
        StakingRouter: stakingRouter.address,
        Curated: operators.address,
        ...addresses
      })

      console.log('--- INMODULE REWORDS DISTRIBUTION ---')
      const opShares = await lido.sharesOf(operators.address)
      console.log('NodeOpeartorRegistry shares', parseInt(opShares))

      const opCount = await operators.getNodeOperatorsCount()
      console.log('op count', parseInt(opCount))
    })
  })
})

async function getLidoStats(lido, args) {
  const data = {}

  const total = await lido.totalSupply()
  const shares = await lido.getTotalShares()

  data.Lido = {
    total: total.toString(),
    sharesByEth: shares.toString()
  }

  for (const property in args) {
    const prop = args[property]

    const prop1balance = await lido.balanceOf(prop)
    const prop1shares = await lido.getSharesByPooledEth(prop1balance)
    const prop1sharesof = await lido.sharesOf(prop)

    data[`${property}`] = {
      total: prop1balance.toString(),
      sharesByEth: prop1shares.toString(),
      sharesOf: prop1sharesof.toString()
    }
  }

  console.table(data)
}

async function stakingRouterStats(stakingRouter) {
  const modules = []
  const modulesCount = await stakingRouter.getModulesCount()

  for (let i = 0; i < modulesCount; i++) {
    const module = await stakingRouter.getModule(i)
    const entry = await IStakingModule.at(module.moduleAddress)

    modules.push({
      // address: entry.address,
      name: module.name,
      cap: parseInt(module.cap),
      fee: parseInt(await entry.getFee()),
      treasuryFee: parseInt(module.treasuryFee),
      paused: module.paused,
      active: module.active,

      totalKeys: parseInt(await entry.getTotalKeys()),
      totalUsedKeys: parseInt(await entry.getTotalUsedKeys()),
      totalStoppedKeys: parseInt(await entry.getTotalStoppedKeys())
    })
  }

  console.table(modules)
}
