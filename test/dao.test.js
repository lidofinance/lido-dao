import test from 'ava'
import {
  getLocalWeb3,
  getApmOptions,
  getAccounts,
  ensRegistry,
  daoAddress,
  daoName,
  KERNEL_DEFAULT_ACL_APP_ID,
  EVMSCRIPT_REGISTRY_APP_ID,
  AGENT_APP_ID,
  FINANCE_APP_ID,
  TOKEN_MANAGER_APP_ID,
  VOTING_APP_ID,
  STETH_APP_ID,
  DEPOOLORACLE_APP_ID,
  DEPOOL_APP_ID
} from "./test-helpers";

import {
  getAllApps,
  getDaoAddress,
} from '@aragon/toolkit'


test.before('Connecting Web3', async (t) => {
  const web3 = await getLocalWeb3()
  // Retrieve web3 accounts.
  const accounts = await getAccounts(web3)
  const options = await getApmOptions()

  t.context = {
    web3,
    accounts,
    options
  }
})
//
test('getDaoAddress returns the correct DAO address', async (t) => {
  const { web3 } = t.context
  const result = await getDaoAddress(daoName, {
    provider: web3.currentProvider,
    registryAddress: ensRegistry,
  })
  t.is(result.toLowerCase(), daoAddress.toLowerCase(), 'DAO address resolve')
})

test('Get DAO apps',
  async t => {
    const { web3 } = t.context
    const apps = await getAllApps(daoAddress, { web3 })
    // console.log(apps)
    t.is(apps.length, 9)
    t.is(
      apps[0].appId,
      KERNEL_DEFAULT_ACL_APP_ID,
      'ACL app id'
    )
    t.is(
      apps[1].appId,
      EVMSCRIPT_REGISTRY_APP_ID,
      'EVM app id'
    )
    t.is(
      apps[2].appId,
      AGENT_APP_ID,
      'VAULT app id'
    )
    t.is(
      apps[3].appId,
      FINANCE_APP_ID,
      'FINANCE app id'
    )
    t.is(
      apps[4].appId,
      TOKEN_MANAGER_APP_ID,
      'TOKEN MANAGER app id'
    )
    t.is(
      apps[5].appId,
      VOTING_APP_ID,
      'VOTING app id'
    )
    t.is(
      apps[6].appId,
      STETH_APP_ID,
      'STETH app id'
    )
    t.is(
      apps[7].appId,
      DEPOOLORACLE_APP_ID,
      'DEPOOLORACLE app id'
    )
    t.is(
      apps[8].appId,
      DEPOOL_APP_ID,
      'DEPOOL app id'
    )
  }
)
