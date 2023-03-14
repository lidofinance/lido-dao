const { artifacts, contract, ethers, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const crypto = require('crypto')
const { ACCOUNTS_AND_KEYS, MAX_UINT256, ZERO_ADDRESS } = require('./helpers/constants')
const { bn } = require('@aragon/contract-helpers-test')
const {
  calculatePermitDigest,
  calculateTransferAuthorizationDigest,
  makeDomainSeparator,
} = require('./helpers/permit_helpers')
const { ETH, hex, hexStringFromBuffer } = require('../helpers/utils')
const { ecSign } = require('../helpers/signatures')
const { EvmSnapshot, setBalance } = require('../helpers/blockchain')

const EIP712StETH = artifacts.require('EIP712StETH')
const StETHPermit = artifacts.require('StETHPermitMock')
const ERC1271PermitSignerMock = artifacts.require('ERC1271PermitSignerMock')

contract('StETHPermit', ([deployer, ...accounts]) => {
  let stEthPermit, eip712StETH, chainId, domainSeparator
  const snapshot = new EvmSnapshot(ethers.provider)

  before('deploy mock token', async () => {
    stEthPermit = await StETHPermit.new({ from: deployer, value: ETH(1) })
    eip712StETH = await EIP712StETH.new(stEthPermit.address, { from: deployer })
    await stEthPermit.initializeEIP712StETH(eip712StETH.address)

    chainId = await web3.eth.net.getId()

    domainSeparator = makeDomainSeparator('Liquid staked Ether 2.0', '2', chainId, stEthPermit.address)
    await snapshot.make()
  })

  const getAccountsEOA = async () => {
    return {
      alice: ACCOUNTS_AND_KEYS[0],
      bob: ACCOUNTS_AND_KEYS[1],
    }
  }

  const getAccountsEIP1271 = async () => {
    const alice = await ERC1271PermitSignerMock.new()
    const bob = await ERC1271PermitSignerMock.new()
    return { alice, bob }
  }

  const signEOA = async (digest, acct) => {
    return ecSign(digest, acct.key)
  }

  const signEIP1271 = async (digest, acct) => {
    const sig = await acct.sign(digest)
    return { v: hex(sig.v), r: hex(sig.r), s: hex(sig.s) }
  }

  afterEach(async () => {
    await snapshot.rollback()
  })

  const test = ({ getAccounts, sign, desc }) => {
    let alice, bob
    let permitParams
    const charlie = accounts[3]

    before(async () => {
      const accts = await getAccounts()
      alice = accts.alice
      bob = accts.bob

      permitParams = {
        owner: alice.address,
        spender: bob.address,
        value: 6e6,
        nonce: 0,
        deadline: MAX_UINT256,
      }

      await snapshot.make()
    })

    const signPermit = async (owner, spender, value, nonce, domainSeparator, deadline, acct) => {
      const digest = calculatePermitDigest(owner, spender, value, nonce, domainSeparator, deadline)
      return await sign(digest, acct)
    }

    const initialTotalSupply = 100e6
    const initialBalance = 90e6

    beforeEach(async () => {
      await stEthPermit.setTotalPooledEther(initialTotalSupply, { from: deployer })
      await stEthPermit.mintShares(permitParams.owner, initialBalance, { from: deployer })
    })

    it('EIP-712 signature helper reverts when zero stETH address passed', async () => {
      await assert.revertsWithCustomError(EIP712StETH.new(ZERO_ADDRESS, { from: deployer }), `ZeroStETHAddress()`)
    })

    it('EIP-712 signature helper contract matches the stored one', async () => {
      assert.equals(await stEthPermit.getEIP712StETH(), eip712StETH.address)
    })

    it('eip712Domain() is correct', async () => {
      const { name, version, chainId, verifyingContract } = await stEthPermit.eip712Domain()

      assert.equals(name, 'Liquid staked Ether 2.0')
      assert.equals(version, '2')
      assert.equals(chainId, await web3.eth.net.getId())
      assert.equals(verifyingContract, stEthPermit.address)

      assert.equals(makeDomainSeparator(name, version, chainId, verifyingContract), domainSeparator)
    })

    it('grants allowance when a valid permit is given', async () => {
      const { owner, spender, deadline } = permitParams
      let { value } = permitParams
      // create a signed permit to grant Bob permission to spend Alice's funds
      // on behalf, and sign with Alice's key
      let nonce = 0

      let { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // check that the allowance is initially zero
      assert.equals(await stEthPermit.allowance(owner, spender), bn(0))
      // check that the next nonce expected is zero
      assert.equals(await stEthPermit.nonces(owner), bn(0))
      // check domain separator
      assert.equals(await stEthPermit.DOMAIN_SEPARATOR(), domainSeparator)

      // a third-party, Charlie (not Alice) submits the permit
      const receipt = await stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie })

      // check that allowance is updated
      assert.equals(await stEthPermit.allowance(owner, spender), bn(value))

      assert.emits(receipt, 'Approval', { owner, spender, value: bn(value) })

      assert.equals(await stEthPermit.nonces(owner), bn(1))

      // increment nonce
      nonce = 1
      value = 4e5
      ;({ v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice))

      // submit the permit
      const receipt2 = await stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie })

      // check that allowance is updated
      assert.equals(await stEthPermit.allowance(owner, spender), bn(value))

      assert.emits(receipt2, 'Approval', { owner, spender, value: bn(value) })

      assert.equals(await stEthPermit.nonces(owner), bn(2))
    })

    it('reverts if the signature does not match given parameters', async () => {
      const { owner, spender, value, nonce, deadline } = permitParams
      // create a signed permit
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // try to cheat by claiming the approved amount + 1
      await assert.reverts(
        stEthPermit.permit(
          owner,
          spender,
          value + 1, // pass more than signed value
          deadline,
          v,
          r,
          s,
          { from: charlie }
        ),
        'INVALID_SIGNATURE'
      )

      // check that msg is incorrect even if claim the approved amount - 1
      await assert.reverts(
        stEthPermit.permit(
          owner,
          spender,
          value - 1, // pass less than signed
          deadline,
          v,
          r,
          s,
          { from: charlie }
        ),
        'INVALID_SIGNATURE'
      )
    })

    it('reverts if the signature is not signed with the right key', async () => {
      const { owner, spender, value, nonce, deadline } = permitParams
      // create a signed permit to grant Bob permission to spend
      // Alice's funds on behalf, but sign with Bob's key instead of Alice's
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, bob)

      // try to cheat by submitting the permit that is signed by a
      // wrong person
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie }),
        'INVALID_SIGNATURE'
      )

      // unlock bob account (allow transactions originated from bob.address)
      await ethers.provider.send('hardhat_impersonateAccount', [bob.address])
      await setBalance(bob.address, ETH(10))

      // even Bob himself can't call permit with the invalid sig
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, {
          from: bob.address,
        }),
        'INVALID_SIGNATURE'
      )
    })

    it('reverts if the permit is expired', async () => {
      const { owner, spender, value, nonce } = permitParams
      // create a signed permit that already invalid
      const deadline = (await stEthPermit.getBlockTime()).toString() - 1
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // try to submit the permit that is expired
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie }),
        'DEADLINE_EXPIRED'
      )

      {
        // create a signed permit that valid for 1 minute (approximately)
        const deadline1min = (await stEthPermit.getBlockTime()).toString() + 60
        const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline1min, domainSeparator, alice)
        const receipt = await stEthPermit.permit(owner, spender, value, deadline1min, v, r, s, { from: charlie })

        assert.equals(await stEthPermit.nonces(owner), bn(1))
        assert.emits(receipt, 'Approval', { owner, spender, value: bn(value) })
      }
    })

    it('reverts if the nonce given does not match the next nonce expected', async () => {
      const { owner, spender, value, deadline } = permitParams
      const nonce = 1
      // create a signed permit
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)
      // check that the next nonce expected is 0, not 1
      assert.equals(await stEthPermit.nonces(owner), bn(0))

      // try to submit the permit
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie }),
        'INVALID_SIGNATURE'
      )
    })

    it('reverts if the permit has already been used', async () => {
      const { owner, spender, value, nonce, deadline } = permitParams
      // create a signed permit
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // submit the permit
      await stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie })

      // try to submit the permit again
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie }),
        'INVALID_SIGNATURE'
      )

      // unlock alice account (allow transactions originated from alice.address)
      await ethers.provider.send('hardhat_impersonateAccount', [alice.address])
      await setBalance(alice.address, ETH(10))

      // try to submit the permit again from Alice herself
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, {
          from: alice.address,
        }),
        'INVALID_SIGNATURE'
      )
    })

    it('reverts if the permit has a nonce that has already been used by the signer', async () => {
      const { owner, spender, value, nonce, deadline } = permitParams
      // create a signed permit
      const permit = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // submit the permit
      await stEthPermit.permit(owner, spender, value, deadline, permit.v, permit.r, permit.s, { from: charlie })

      // create another signed permit with the same nonce, but
      // with different parameters
      const permit2 = await signPermit(owner, spender, 1e6, nonce, deadline, domainSeparator, alice)

      // try to submit the permit again
      await assert.reverts(
        stEthPermit.permit(owner, spender, 1e6, deadline, permit2.v, permit2.r, permit2.s, { from: charlie }),
        'INVALID_SIGNATURE'
      )
    })

    it('reverts if the permit includes invalid approval parameters', async () => {
      const { owner, value, nonce, deadline } = permitParams
      // create a signed permit that attempts to grant allowance to the
      // zero address
      const spender = ZERO_ADDRESS
      const { v, r, s } = await signPermit(owner, spender, value, nonce, deadline, domainSeparator, alice)

      // try to submit the permit with invalid approval parameters
      await assert.reverts(
        stEthPermit.permit(owner, spender, value, deadline, v, r, s, { from: charlie }),
        'APPROVE_TO_ZERO_ADDR'
      )
    })

    it('reverts if the permit is not for an approval', async () => {
      const { owner: from, spender: to, value, deadline: validBefore } = permitParams
      // create a signed permit for a transfer
      const validAfter = 0
      const nonce = hexStringFromBuffer(crypto.randomBytes(32))
      const digest = calculateTransferAuthorizationDigest(
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        domainSeparator
      )
      const { v, r, s } = await sign(digest, alice)

      // try to submit the transfer permit
      await assert.reverts(
        stEthPermit.permit(from, to, value, validBefore, v, r, s, { from: charlie }),
        'INVALID_SIGNATURE'
      )
    })
  }

  context(`permit (ECDSA)`, () => test({ getAccounts: getAccountsEOA, sign: signEOA }))
  context(`permit (EIP-1271)`, () => test({ getAccounts: getAccountsEIP1271, sign: signEIP1271 }))
})
