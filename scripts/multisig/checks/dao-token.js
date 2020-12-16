const chalk = require('chalk')
const BN = require('bn.js')

const { assert } = require('../../helpers/assert')
const { log, yl } = require('../../helpers/log')

async function assertVesting({
  tokenManager,
  token,
  vestingParams,
  unvestedTokensManagerAddress
}) {
  const { holders, amounts } = vestingParams

  const vestings = await Promise.all(
    holders.map(async (addr) => {
      try {
        return await tokenManager.getVesting(addr, 0)
      } catch (err) {
        if (err.message.indexOf('TM_NO_VESTING') !== -1) {
          return null
        } else {
          throw err
        }
      }
    })
  )

  const tokenBalances = await Promise.all(
    holders.map(addr => token.balanceOf(addr))
  )

  const unvestedTokensAmount = new BN(vestingParams.unvestedTokensAmount)

  const expectedTotalSupply = amounts.reduce(
    (acc, value) => acc.add(new BN(value)), unvestedTokensAmount
  )

  vestings.forEach((vesting, i) => {
    const holderAddr = holders[i];

    assert.exists(vesting, `vesting exists for ${holderAddr}`)
    assert.bnEqual(vesting.amount, amounts[i], `vested amount matches for ${holderAddr}`)
    assert.bnEqual(tokenBalances[i], amounts[i], `token balance matches the vested amount for ${holderAddr}`)
    assert.bnEqual(vesting.start, vestingParams.start, `vesting start matches for ${holderAddr}`)
    assert.bnEqual(vesting.cliff, vestingParams.cliff, `vesting cliff matches for ${holderAddr}`)
    assert.bnEqual(vesting.vesting, vestingParams.end, ` vesting end matches for ${holderAddr}`)
    assert.equal(vesting.revokable, vestingParams.revokable, `revokable matches for ${holderAddr}`)

    log.success(
      `holder ${holderAddr}: vesting is correct, token balance is ${chalk.yellow(amounts[i])}`,
      `(${+vesting.amount.muln(10000).div(expectedTotalSupply) / 100}%)`
    )
  })

  log.splitter()

  if (unvestedTokensAmount.gtn(0)) {
    assert.log(
      assert.bnEqual,
      await token.balanceOf(unvestedTokensManagerAddress),
      unvestedTokensAmount,
      `total ${yl('' + unvestedTokensAmount)} unvested tokens are held by ${yl(unvestedTokensManagerAddress)}`
    )
  }

  assert.log(
    assert.bnEqual,
    await token.totalSupply(),
    expectedTotalSupply,
    `no other tokens are issued, totalSupply is ${chalk.yellow('' + expectedTotalSupply)}`
  )
}

module.exports = { assertVesting }
