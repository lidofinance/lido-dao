import test from 'ava'
import * as depositContractHelper from '../scripts/helpers/apps/depositContractHelper'

import {
  ether,
  expectEvent // Assertions for emitted events
} from '@openzeppelin/test-helpers'
import { prepareContext } from '../scripts/helpers'

test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext()
  depositContractHelper.init(t.context)
})

test('DepositContract', async (t) => {
  const { accounts } = t.context
  // Use the different accounts, which are unlocked and funded with Ether
  const [dev] = accounts

  // mock data for validator
  const validatorData = {
    pubkey: '0x8769d4a1f8e2a58b0ffbfa73baea6b388bbed44c3a0d3d188be98ae94c7b0287c2e73233330e1a3ad740b276e9c2a983',
    withdrawal_credentials: '0x0039ccd625b584a84322b2b5288b2062d8ce27a33351b5713e67234ae57a6745',
    signature:
      '0x964c30bd77831ccf926ffc4879cdaf6a89b540a5bed5006256af35c3e0fabe77892d5f478bfc6748149e63a842f9ff4e162bcef4324fe1dd254a9f8651a30b193b0d567aee2ae446b3d32014de6afaf6278463dd942b353a346f361fc2d50eed',
    deposit_data_root: '0x57f0444e89f6849ea26eb9720a92bd38cc3e95cb8f26eeaa1dec9477b5aed497'
  }

  const receipt = await depositContractHelper.deposit(dev, ether('32'), validatorData)
  // console.log(receipt)
  expectEvent(receipt, 'DepositEvent', {
    pubkey: validatorData.pubkey,
    withdrawal_credentials: validatorData.withdrawal_credentials,
    signature: validatorData.signature,
    amount: '0x0040597307000000' // 32eth in gweis converted to little endian bytes
  })
  t.pass()
})
