const crypto = require('crypto')
const { ACCOUNTS_AND_KEYS, MAX_UINT256, ZERO_ADDRESS } = require('./helpers/constants')
const { bn } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { signPermit, signTransferAuthorization, permitTypeHash, makeDomainSeparator } = require('./helpers/permit_helpers')

const EIP712StETH = artifacts.require('EIP712StETHMock')
const StETHPermit = artifacts.require('StETHPermitMock')

contract('StETHPermit', ([deployer, ...accounts]) => {
  let stEthPermit, chainId, domainSeparator

  beforeEach('deploy mock token', async () => {
    const eip712StETH = await EIP712StETH.new({ from: deployer })
    stEthPermit = await StETHPermit.new({ from: deployer })
    await stEthPermit.initializeEIP712StETH(eip712StETH.address)

    // We get the chain id from the contract because Ganache (used for coverage) does not return the same chain id
    // from within the EVM as from the JSON RPC interface.
    // See https://github.com/trufflesuite/ganache-core/issues/515
    chainId = await eip712StETH.getChainId()
    domainSeparator = makeDomainSeparator('StETH', '1', chainId, eip712StETH.address)
  })

  describe('permit', () => {
    const [alice, bob] = ACCOUNTS_AND_KEYS
    const charlie = accounts[1]

    const initialTotalSupply = 100e6
    const initialBalance = 10e6

    const permitParams = {
      owner: alice.address,
      spender: bob.address,
      value: 5e6,
      nonce: 0,
      deadline: MAX_UINT256
    }

    beforeEach(async () => {
      await stEthPermit.setTotalPooledEther(initialTotalSupply, { from: deployer })
      await stEthPermit.mintShares(permitParams.owner, initialBalance, { from: deployer })
    })

    it.only('grants allowance when a valid permit is given', async () => {
      const { owner, spender, deadline } = permitParams
      let { value } = permitParams
      // create a signed permit to grant Bob permission to spend Alice's funds
      // on behalf, and sign with Alice's key
      let nonce = 0

      let { v, r, s } = signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice.key)

      // check that the allowance is initially zero
      assertBn(await stEthPermit.allowance(owner, spender), bn(0))
      // check that the next nonce expected is zero
      assertBn(await stEthPermit.nonces(owner), bn(0))
      // check domain separator
      assert.equal(
        await stEthPermit.DOMAIN_SEPARATOR(),
        domainSeparator
      )

      // a third-party, Charlie (not Alice) submits the permit
      const receipt = await stEthPermit.permit(
        owner, spender, value, deadline, v, r, s, { from: charlie }
      )

      // check that allowance is updated
      assertBn(await stEthPermit.allowance(owner, spender), bn(value))

      assertEvent(
        receipt,
        'Approval',
        { 'owner': owner, 'spender': spender, 'value': bn(value) }
      )

      assertBn(await stEthPermit.nonces(owner), bn(1))

      // increment nonce
      nonce = 1
      value = 1e6
      ;({ v, r, s } = signPermit(owner, spender, 1e6, nonce, deadline, domainSeparator, alice.key))

      // submit the permit
      const receipt2 = await stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie })

      // check that allowance is updated
      assertBn(await stEthPermit.allowance(owner, spender), bn(value))

      assertEvent(
        receipt2,
        'Approval',
        { 'owner': owner, 'spender': spender, 'value': bn(value) }
      )
    })
  })
})
