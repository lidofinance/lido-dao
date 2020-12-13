const chalk = require('chalk')
const BN = require('bn.js')
const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const { log } = require('../../helpers/log')

async function assertVesting({ tokenManagerAddress, tokenAddress, vestingParams }) {
  const { holders, amounts } = vestingParams

  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  log(`Using TokenManager: ${chalk.yellow(tokenManagerAddress)}`)

  const token = await artifacts.require('MiniMeToken').at(tokenAddress)
  log(`Using MiniMeToken: ${chalk.yellow(tokenAddress)}`)

  log.splitter()

  const vestings = await Promise.all(
    holders.map(addr => tokenManager.getVesting(addr, 0))
  )

  const tokenBalances = await Promise.all(
    holders.map(addr => token.balanceOf(addr))
  )

  const expectedTotalSupply = amounts.reduce(
    (acc, value) => acc.add(new BN(value)), new BN(0)
  )

  vestings.forEach((vesting, i) => {
    const holderAddr = holders[i];

    assertBn(vesting.amount, amounts[i], `vested amount matches for ${holderAddr}`)
    assertBn(tokenBalances[i], amounts[i], `token balance matches the vested amount for ${holderAddr}`)
    assertBn(vesting.start, vestingParams.start, `vesting start matches for ${holderAddr}`)
    assertBn(vesting.cliff, vestingParams.cliff, `vesting cliff matches for ${holderAddr}`)
    assertBn(vesting.vesting, vestingParams.end, ` vesting end matches for ${holderAddr}`)
    assert.equal(vesting.revokable, vestingParams.revokable, `revokable matches for ${holderAddr}`)

    log.success(
      `holder ${holderAddr}: vesting is correct, token balance is ${chalk.yellow(amounts[i])}`,
      `(${+vesting.amount.muln(10000).div(expectedTotalSupply) / 100}%)`
    )
  })

  log.splitter()

  const checkDesc = `no tokens are issued except the vested ones, totalSupply is ${chalk.yellow('' + expectedTotalSupply)}`
  const totalSupply = await token.totalSupply()
  assertBn(totalSupply, expectedTotalSupply, checkDesc)
  log.success(checkDesc)
}

module.exports = { assertVesting }
