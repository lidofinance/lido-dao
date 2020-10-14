const { getAllApps, getDaoAddress } = require('@aragon/toolkit')
const { getAccounts, getLocalWeb3 } = require('./eth1Helper')
const logger = require('./logger')

const {
  ensRegistry,
  daoName,
  DEPOOL_APP_ID,
  DEPOOLORACLE_APP_ID,
  STETH_APP_ID,
  SP_REGISTRY_APP_ID,
  VOTING_APP_ID,
  FINANCE_APP_ID,
  TOKEN_MANAGER_APP_ID,
  AGENT_APP_ID,
  KERNEL_DEFAULT_ACL_APP_ID
} = require('./constants')

const findApp = (apps, id) => apps.find((app) => app.appId === id)

const prepareContext = async (params) => {
  const web3 = await getLocalWeb3()
  // Retrieve web3 accounts.
  const accounts = await getAccounts(web3)
  const daoAddress = await getDaoAddress(daoName, {
    provider: web3.currentProvider,
    registryAddress: ensRegistry
  })
  const apps = await getAllApps(daoAddress, { web3 })
  const aclApp = findApp(apps, KERNEL_DEFAULT_ACL_APP_ID)
  const votingApp = findApp(apps, VOTING_APP_ID)
  const financeApp = findApp(apps, FINANCE_APP_ID)
  const vaultApp = findApp(apps, AGENT_APP_ID)
  const stakingProvidersApp = findApp(apps, SP_REGISTRY_APP_ID)
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
      aclApp,
      votingApp,
      financeApp,
      vaultApp,
      tokenManagerApp,
      stEthApp,
      dePoolOracleApp,
      dePoolApp,
      stakingProvidersApp
    }
  }
}
exports.prepareContext = prepareContext
