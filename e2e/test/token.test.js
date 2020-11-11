import test from 'ava'
import { prepareContext } from '../scripts/helpers'

import { abi as tokenManagerAbi } from '@aragon/apps-token-manager/abi/TokenManager.json'
import { abi as tokenAbi } from '@aragon/apps-token-manager/abi/MiniMeToken.json'

test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext()
})

test('Tokens', async (t) => {
  const { web3, accounts, apps } = t.context

  const { tokenManagerApp } = apps
  if (!tokenManagerApp) throw Error(`TokenManager app not found`)
  const tokenManagerAddress = tokenManagerApp.proxyAddress
  // console.log(`Retrieved TokenManager app: ${tokenManagerAddress}`)

  const TokenManager = new web3.eth.Contract(tokenManagerAbi, tokenManagerAddress)

  const tokenAddress = await TokenManager.methods.token().call()
  // console.log(`Retrieved Token: ${tokenManagerAddress}`)
  const Token = new web3.eth.Contract(tokenAbi, tokenAddress)

  const [name, symbol, decimals] = await Promise.all([
    Token.methods.name().call(),
    Token.methods.symbol().call(),
    Token.methods.decimals().call()
  ])
  const totalSupply = web3.utils.fromWei(await Token.methods.totalSupply().call())
  const [owner, holder1, holder2] = accounts
  const balance = web3.utils.fromWei(await Token.methods.balanceOf(holder1).call())

  // console.log({name, symbol, decimals, totalSupply, balance })

  t.is(name, 'Lido DAO Token', 'Token name')
  t.is(symbol, 'LDO', 'Token symbol')
  t.is(decimals, '18', 'Token decimals')
  t.is(totalSupply, '500', 'Token totalSupply')
  t.is(balance, '100', 'Account balance')

  // t.pass()
})
