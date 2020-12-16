import { getAllApps, getDaoAddress } from '@aragon/toolkit'
import { getAccounts, getLocalWeb3 } from './eth1Helper'

import {
  ensRegistry,
  daoAddress,
  daoName,
  LIDO_APP_ID,
  LIDOORACLE_APP_ID,
  STETH_APP_ID,
  NODE_OPERATORS_REGISTRY_APP_ID,
  VOTING_APP_ID,
  FINANCE_APP_ID,
  TOKEN_MANAGER_APP_ID,
  AGENT_APP_ID,
  KERNEL_DEFAULT_ACL_APP_ID
} from './constants'

const findApp = (apps, id) => apps.find((app) => app.appId === id)

export const prepareContext = async () => {
  const web3 = await getLocalWeb3()
  // Retrieve web3 accounts.
  const accounts = await getAccounts(web3)
  // const daoAddress = await getDaoAddress(daoName, {
  //   provider: web3.currentProvider,
  //   registryAddress: ensRegistry
  // })
  const apps = await getAllApps(daoAddress, { web3 })
  const aclApp = findApp(apps, KERNEL_DEFAULT_ACL_APP_ID)
  const votingApp = findApp(apps, VOTING_APP_ID)
  const financeApp = findApp(apps, FINANCE_APP_ID)
  const vaultApp = findApp(apps, AGENT_APP_ID)
  const nodeOperatorsApp = findApp(apps, NODE_OPERATORS_REGISTRY_APP_ID)
  const tokenManagerApp = findApp(apps, TOKEN_MANAGER_APP_ID)
  // const stEthApp = findApp(apps, STETH_APP_ID)
  const lidoOracleApp = findApp(apps, LIDOORACLE_APP_ID)
  const lidoApp = findApp(apps, LIDO_APP_ID)

  return {
    web3,
    accounts,
    ens: ensRegistry,
    dao: {
      name: daoName,
      address: daoAddress
    },
    apps: {
      aclApp,
      votingApp,
      financeApp,
      vaultApp,
      tokenManagerApp,
      // stEthApp,
      lidoOracleApp,
      lidoApp,
      nodeOperatorsApp
    }
  }
}
