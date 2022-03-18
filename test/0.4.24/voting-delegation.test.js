const { assert } = require('chai')
const { newDao, newApp } = require('./helpers/dao')
const { assertBn, assertRevert, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')
const { pct16, bn, bigExp, getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { installNewApp, ANY_ENTITY } = require('@aragon/contract-helpers-test/src/aragon-os')

const { toBN } = require('../helpers/utils')
const { BN } = require('bn.js')
const ERRORS = require('./helpers/voting-errors')

const TokenManager = artifacts.require('TokenManagerMock')
const Voting = artifacts.require('VotingMock.sol')
const MiniMeToken = artifacts.require('@aragon/minime/contracts/MiniMeToken.sol:MiniMeToken')
const LDOProxy = artifacts.require('LDOProxy')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const transferable = true

contract('Lido voting delegation', ([appManager, user1, user2, user3, nobody]) => {
  let dao, acl, voting, token, tokenProxy, tokenManager

  const NOW = 1
  const votingDuration = 1000
  const APP_ID = '0x1234123412341234123412341234123412341234123412341234123412341234'
  const APP_TOKEN_MANAGER_ID = '0x1234123412341234123412341234123412341234123412341234123412341235'

  beforeEach('deploy dao and app', async () => {
    daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // setup voting
    const votingBase = await Voting.new()
    const proxyAddressVoting = await newApp(dao, 'voting', votingBase.address, appManager)
    voting = await Voting.at(proxyAddressVoting)

    await acl.createPermission(appManager, voting.address, await votingBase.CREATE_VOTES_ROLE(), appManager, { from: appManager })
    await acl.createPermission(appManager, voting.address, await votingBase.MODIFY_SUPPORT_ROLE(), appManager, { from: appManager })
    await acl.createPermission(appManager, voting.address, await votingBase.MODIFY_QUORUM_ROLE(), appManager, { from: appManager })

    // setup token
    token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'test token', 0, 'TT', true) // empty parameters minime
    tokenProxy = await LDOProxy.new(token.address)

    // setup token manager
    const tokenManagerBase = await TokenManager.new()
    const proxyAddressTokenManager = await newApp(dao, 'token-manager', tokenManagerBase.address, appManager)
    tokenManager = await TokenManager.at(proxyAddressTokenManager)

    await acl.createPermission(appManager, tokenManager.address, await tokenManagerBase.ISSUE_ROLE(), appManager, { from: appManager })
    await acl.createPermission(appManager, tokenManager.address, await tokenManagerBase.ASSIGN_ROLE(), appManager, { from: appManager })
    await acl.createPermission(appManager, tokenManager.address, await tokenManagerBase.SET_WRAPPED_TOKEN_ROLE(), appManager, {
      from: appManager
    })

    // setup tokenmanager and voting
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)
    await voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, votingDuration)

    const contracts = {
      dao: { address: dao.address },
      acl: { address: acl.address },
      token: { address: token.address },
      tokenProxy: { address: tokenProxy.address },
      tokenManager: { address: tokenManager.address },
      appManager: { address: appManager },
      user1: { address: user1 },
      user2: { address: user2 },
      user3: { address: user3 }
    }
    console.table(contracts)
  })

  context('normal token supply, common tests', async () => {
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)

    it('fails on reinitialization', async () => {
      await assertRevert(
        voting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, votingDuration),
        ERRORS.INIT_ALREADY_INITIALIZED
      )
    })

    it('cannot initialize base app', async () => {
      const newVoting = await Voting.new()
      assert.isTrue(await newVoting.isPetrified())
      await assertRevert(
        newVoting.initialize(token.address, neededSupport, minimumAcceptanceQuorum, votingDuration),
        ERRORS.INIT_ALREADY_INITIALIZED
      )
    })
  })

  context('token generation', async () => {
    beforeEach(async function () {
      await token.changeController(tokenManager.address)
      await tokenManager.initialize(token.address, transferable, 0)
      await tokenManager.setWrappedToken(tokenProxy.address)

      await tokenManager.issue(600)

      await tokenManager.assign(user1, 100)
      await tokenManager.assign(user2, 200)
      // await tokenManager.assign(user3, 300)
    })

    it('check total supply', async () => {
      assert.equal(await token.totalSupply(), 600)
    })

    it('check user tokens', async () => {
      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await token.balanceOf(user2), 200)
      assert.equal(await token.balanceOf(user3), 300)
    })

    it('check total supply through proxy', async () => {
      assert.equal(await tokenProxy.totalSupply(), 600)
    })

    it('check user tokens through proxy', async () => {
      assert.equal(await tokenProxy.balanceOf(user1), 100)
      assert.equal(await tokenProxy.balanceOf(user2), 200)
      assert.equal(await tokenProxy.balanceOf(user3), 300)
    })
  })

  context('voting delegation proxy', async () => {
    beforeEach(async function () {
      await token.changeController(tokenManager.address)
      await tokenManager.initialize(token.address, transferable, 0)

      await tokenManager.setWrappedToken(tokenProxy.address)

      // console.log('Issue 600 tokens')
      // console.log('Sender ', appManager)

      // await tokenManager.issue(600)

      // await tokenManager.assign(user1, 100)
      // await tokenManager.assign(user2, 200)
      // await tokenManager.assign(user3, 300)

      // console.log('power',(await tokenProxy.getCurrentVotes(user1)).toString())
      // console.log('power',(await tokenProxy.getCurrentVotes(user2)).toString())
      // console.log('power',(await tokenProxy.getCurrentVotes(user3)).toString())
    })

    it('user1 no voting power', async () => {
      assert.equal(await tokenProxy.getCurrentVotes(user1), 0)
    })

    it('user1 delegate voting power to user1 (self)', async () => {
      await tokenProxy.delegate(user1, { from: user1 })

      assert.equal(await tokenProxy.getCurrentVotes(user1), 100)
    })

    it('user1 delegate voting power to user2', async () => {
      await tokenProxy.delegate(user2, { from: user1 })

      assert.equal(await tokenProxy.getCurrentVotes(user1), 0)
      assert.equal(await tokenProxy.getCurrentVotes(user2), 100)

      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await token.balanceOf(user2), 200)

      assert.equal(await tokenProxy.balanceOf(user1), 100)
      assert.equal(await tokenProxy.balanceOf(user2), 200)
    })

    it('delegate voting power', async () => {
      // user1 has 100 tokens 100 VP
      await tokenProxy.delegate(user1, { from: user1 })
      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await tokenProxy.getCurrentVotes(user1), 100)

      // user1 has 100tokens, 100+200=300 VP
      await tokenProxy.delegate(user1, { from: user2 })
      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await tokenProxy.getCurrentVotes(user1), 300)

      assert.equal(await token.balanceOf(user2), 200)
      assert.equal(await tokenProxy.getCurrentVotes(user2), 0)

      // user1 has 100tokens, 300-200=100 VP, user 2 has 200 VP
      await tokenProxy.delegate(user2, { from: user2 })
      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await tokenProxy.getCurrentVotes(user1), 100)

      assert.equal(await token.balanceOf(user2), 200)
      assert.equal(await tokenProxy.getCurrentVotes(user2), 200)

      // user1 has 100 tokens 100+300 VP
      await tokenProxy.delegate(user1, { from: user3 })
      assert.equal(await token.balanceOf(user1), 100)
      assert.equal(await tokenProxy.getCurrentVotes(user1), 400)

      assert.equal(await token.balanceOf(user2), 200)
      assert.equal(await tokenProxy.getCurrentVotes(user2), 200)

      assert.equal(await token.balanceOf(user3), 300)
      assert.equal(await tokenProxy.getCurrentVotes(user3), 0)
    })

    it('delegate voting power and transfer token', async () => {
      await tokenProxy.delegate(user1, { from: user1 })
      await tokenProxy.delegate(user1, { from: user2 })
      await tokenProxy.delegate(user2, { from: user2 })
      await tokenProxy.delegate(user1, { from: user3 })

      // user1 has 100-50=50 tokens, VP 400-50=350, user3 has 300+50=350 tokens
      await token.transfer(user3, 50, { from: user1 })

      const accs = [user1, user2, user3]
      for (let i = 0; i < accs.length; i++) {
        const userVP = await tokenProxy.getCurrentVotes(accs[i])
        const userTB = await token.balanceOf(accs[i])
        const userTPB = await tokenProxy.balanceOf(accs[i])

        console.log(`===user${i + 1}===`)
        console.log(`User${i + 1} voting power: ` + userVP.toString())
        console.log(`User${i + 1} token balance: ` + userTB.toString())
        console.log(`User${i + 1} token proxy balance: ` + userTPB.toString())
      }

      assert.equal(await token.balanceOf(user1), 50)
      assert.equal(await tokenProxy.getCurrentVotes(user1), 350)

      assert.equal(await token.balanceOf(user2), 200)
      assert.equal(await tokenProxy.getCurrentVotes(user2), 200)

      assert.equal(await token.balanceOf(user3), 350)
      assert.equal(await tokenProxy.getCurrentVotes(user3), 0)
    })
  })
})
