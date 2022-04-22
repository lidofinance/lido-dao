const { expect, assert } = require('chai')
const { ethers, artifacts } = require('hardhat')
const { MerkleTree } = require('merkletreejs')
const keccak256 = require('keccak256')
const { BN } = require('@openzeppelin/test-helpers')
const fs = require('fs')
const { newDao, newApp } = require('./0.4.24/helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const filename = 'account-rewards.json'

const Lido = artifacts.require('LidoMockForMerkle.sol')
const OracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')
const ERC20Mock = artifacts.require('ERC20Mock.sol')
const MerkleDistributor = artifacts.require('MerkleDistributor')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const wei = (value) => web3.utils.toWei(value + '', 'wei')
const getPackedAmount = (value) => new BN(value).toString(16, 64)
const getPackedAmountFromHex = (value) => new BN(value.replace(/^0x/, ''), 16).toString(16, 64)

contract('MerkleRewards', (accounts) => {
  let lidoBase, nodeOperatorsRegistryBase, lido, oracle, depositContract, operators
  let treasuryAddr, insuranceAddr
  let dao, acl
  let merkle
  let accs = []
  let token

  // accounts
  let appManager, voting, depositor, operator1, operator2, operator3

  before('deploy base app', async () => {
    accs = accounts
    ;[appManager, voting, depositor, operator1, operator2, operator3, user1, user2, user3] = accs

    // Deploy the app's base contract.
    lidoBase = await Lido.new()
    oracle = await OracleMock.new()
    yetAnotherOracle = await OracleMock.new()
    depositContract = await DepositContractMock.new()
    nodeOperatorsRegistryBase = await NodeOperatorsRegistry.new()
    anyToken = await ERC20Mock.new()
  })

  beforeEach('deploy dao and app', async () => {
    ;({ dao, acl } = await newDao(appManager))

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await Lido.at(proxyAddress)

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistry.at(proxyAddress)
    await operators.initialize(lido.address)

    // Set up the app's permissions.
    await acl.createPermission(voting, lido.address, await lido.PAUSE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_FEE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.MANAGE_WITHDRAWAL_KEY(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_TREASURY(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_ORACLE(), appManager, { from: appManager })
    await acl.createPermission(voting, lido.address, await lido.SET_INSURANCE_FUND(), appManager, { from: appManager })

    await acl.createPermission(voting, operators.address, await operators.MANAGE_SIGNING_KEYS(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.ADD_NODE_OPERATOR_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_NAME_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(voting, operators.address, await operators.SET_NODE_OPERATOR_LIMIT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(voting, operators.address, await operators.REPORT_STOPPED_VALIDATORS_ROLE(), appManager, {
      from: appManager
    })
    await acl.createPermission(depositor, lido.address, await lido.DEPOSIT_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getTreasury()
    insuranceAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    // set merkle
    merkle = await MerkleDistributor.new(lido.address)
  })

  context('common tests', async () => {
    it('check zero distibution', async () => {
      const rewardsAmount = 0

      // added holders
      const operators = []
      for (let i = 0; i < accs.length; i++) {
        operators.push(accs[i])
      }

      const leaves = operators.map((x) => keccak256(x + getPackedAmount(ETH(0))))
      const tree = new MerkleTree(leaves, keccak256, { sort: true })
      const root = tree.getHexRoot()

      // set merkle root in contract
      await merkle.pushRewards(root)

      // console.log(tree.toString())
      const merkleBalance = await lido.balanceOf(merkle.address)

      assert.equal(merkleBalance, 0)
    })

    it('check accounts.json', async () => {
      const json = JSON.parse(fs.readFileSync(filename, { encoding: 'utf8' }))
      const accounts = json.accounts

      const leaves = Object.keys(json.accounts).map((x) => keccak256(x + getPackedAmountFromHex(accounts[x])))
      const tree = new MerkleTree(leaves, keccak256, { sort: true })
      const root = tree.getHexRoot()

      assert.equal(root, json.merkleRoot)
    })

    it('generate rewards', async () => {
      let rewardsAmount = 0

      const operatorsCounts = 10

      // added holders
      const operators = []
      for (let i = 0; i < operatorsCounts; i++) {
        const operator = {
          address: accs[i],
          rewards: ETH(1)
        }
        operators.push(operator)

        rewardsAmount += +operator.rewards
      }

      const leaves = operators.map((x) => keccak256(x.address + getPackedAmount(x.rewards)))
      const tree = new MerkleTree(leaves, keccak256, { sort: true })
      const root = tree.getHexRoot()

      const user1 = accs[1]
      await web3.eth.sendTransaction({ to: lido.address, from: user1, value: rewardsAmount.toString() })

      // set merkle root in contract
      await merkle.pushRewards(root)

      const total = await lido.totalSupply()

      assert.equal(total.toString(), ETH(10))
    })

    it('check claim', async () => {
      let rewardsAmount = 0

      // added holders
      const operators = []
      for (let i = 0; i < 4; i++) {
        const operator = {
          address: accs[i],
          rewards: ETH(1)
        }
        operators.push(operator)

        rewardsAmount += +operator.rewards
      }

      const leaves = operators.map((x) => keccak256(x.address + getPackedAmount(x.rewards)))
      const tree = new MerkleTree(leaves, keccak256, { sort: true })
      const root = tree.getHexRoot()

      // set merkle root in contract
      await merkle.pushRewards(root)

      await web3.eth.sendTransaction({ to: lido.address, from: user1, value: ETH(4) })
      await lido.mintShares(lido.address, ETH(2))

      const totalPre = await lido.totalSupply()

      assert.equal(totalPre.toString(), ETH(4))

      // console.log(tree.toString())

      const claimAmount = ETH(1)

      // get operator leaf
      const leaf = MerkleTree.bufferToHex(keccak256(operator1 + getPackedAmount(ETH(1))))
      const claimProof = tree.getHexProof(leaf)

      const balanceOperatorBefore = await lido.balanceOf(operator1)
      assert.equal(balanceOperatorBefore, 0)

      // claim
      await merkle.claim(ETH(1), claimProof, { from: operator1 })

      const totalPost = await lido.totalSupply()
      assert.equal(totalPost, ETH(4))

      const balanceOperatorAfter = await lido.sharesOf(operator1)

      assert.equal(balanceOperatorAfter, claimAmount)

      // cant claim twice
      await assertRevert(merkle.claim(ETH(1), claimProof, { from: operator1 }), 'Nothing to claim')
    })

    it('check claim from json file', async () => {
      const json = JSON.parse(fs.readFileSync(filename, { encoding: 'utf8' }))
      const accounts = json.accounts

      // create merkleroot
      const leaves = Object.keys(json.accounts).map((x) => keccak256(x + getPackedAmountFromHex(accounts[x])))
      const tree = new MerkleTree(leaves, keccak256, { sort: true })
      const root = tree.getHexRoot()

      // set merkle root in contract
      await merkle.pushRewards(root)

      // 10 eth
      const totalRewards = new BN(json.totalRewards.replace(/^0x/, ''), 16)

      await web3.eth.sendTransaction({ to: lido.address, from: user1, value: ETH(10) })
      await lido.mintShares(lido.address, ETH(10))

      assert.equal(await lido.totalSupply(), ETH(10))

      // get first operator from file
      const claimOperator = Object.keys(accounts)[0]
      const claimAmount = ETH(1)

      const leaf = MerkleTree.bufferToHex(keccak256(claimOperator + getPackedAmount(claimAmount)))
      const claimProof = tree.getHexProof(leaf)

      // check token balance before
      const balanceOperatorBefore = await lido.sharesOf(claimOperator)
      assert.equal(balanceOperatorBefore, 0)

      // console.log(tree.toString())

      // claim
      await merkle.claim(claimAmount, claimProof, { from: operator1 })

      // check token balance after
      const balanceOperatorAfter = await lido.sharesOf(claimOperator)
      assert.equal(balanceOperatorAfter, ETH(1))
    })

    // generate rewards
    // someone add eth
    // generate -> stETH
    // distibute rewards for operators (ts fee/ MEV)

    // distibute rewards 1ETH as rewards for node opeartors
    // acc1 - 0.1 eth
    // acc2 - 0.2 eth
    // acc3 - 0.7 eth

    // add oracle contract for qourum 3/5 -> accept

    // oracle distribute rewards + generate merkle root for proof (??)

    // only owner can transfer their balance
  })
})
