import { getAllApps, getDaoAddress } from '@aragon/toolkit'
import { getLocalWeb3 } from './base'
import { getAccounts } from './eth1Helper'
import { getLogger } from './utils'

import {
  ensRegistry,
  daoName,
  DEPOOL_APP_ID,
  DEPOOLORACLE_APP_ID,
  STETH_APP_ID,
  VOTING_APP_ID,
  FINANCE_APP_ID,
  TOKEN_MANAGER_APP_ID,
  AGENT_APP_ID
} from './constants'

export const findApp = (apps, id) => apps.find((app) => app.appId === id)

export const prepareContext = async (params) => {
  const web3 = await getLocalWeb3()
  // Retrieve web3 accounts.
  const accounts = await getAccounts(web3)
  const logger = getLogger()
  const daoAddress = await getDaoAddress(daoName, {
    provider: web3.currentProvider,
    registryAddress: ensRegistry
  })
  const apps = await getAllApps(daoAddress, { web3 })
  const votingApp = findApp(apps, VOTING_APP_ID)
  const financeApp = findApp(apps, FINANCE_APP_ID)
  const vaultApp = findApp(apps, AGENT_APP_ID)
  const tokenManagerApp = findApp(apps, TOKEN_MANAGER_APP_ID)
  const stEthApp = findApp(apps, STETH_APP_ID)
  const dePoolOracleApp = findApp(apps, DEPOOLORACLE_APP_ID)
  const dePoolApp = findApp(apps, DEPOOL_APP_ID)

  return {
    web3,
    accounts,
    logger,
    ens: ensRegistry,
    dao: {
      name: daoName,
      address: daoAddress
    },
    apps: {
      votingApp,
      financeApp,
      vaultApp,
      tokenManagerApp,
      stEthApp,
      dePoolOracleApp,
      dePoolApp
    }
  }
}
