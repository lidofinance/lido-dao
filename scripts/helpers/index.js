const fs = require('fs')
const Web3 = require('web3')
const { getAllApps, getDaoAddress } = require('@aragon/toolkit')

const {
  ensRegistry,
  daoName,
  DEPOOL_APP_ID,
  DEPOOLORACLE_APP_ID,
  STETH_APP_ID,
  VOTING_APP_ID,
  FINANCE_APP_ID,
  TOKEN_MANAGER_APP_ID,
  AGENT_APP_ID,
  SPREGISTRY_APP_ID,
  KERNEL_DEFAULT_ACL_APP_ID
} = require('./constants')

const findApp = (apps, id) => apps.find((app) => app.appId === id)

const getLocalWeb3 = async () => {
  const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://localhost:8545`))
  // const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://195.201.102.242:8545`))
  const connected = await web3.eth.net.isListening()
  if (!connected) throw new Error('Web3 connection failed')
  return web3
}
exports.getLocalWeb3 = getLocalWeb3

const getAccounts = async (web3) =>
  new Promise((resolve, reject) => {
    web3.eth.getAccounts((err, res) => (err ? reject(err) : resolve(res)))
  })

exports.getAccounts = getAccounts

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
  const tokenManagerApp = findApp(apps, TOKEN_MANAGER_APP_ID)
  const stEthApp = findApp(apps, STETH_APP_ID)
  const dePoolOracleApp = findApp(apps, DEPOOLORACLE_APP_ID)
  const dePoolApp = findApp(apps, DEPOOL_APP_ID)
  const spRegistryApp = findApp(apps, SPREGISTRY_APP_ID)

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
      stEthApp,
      dePoolOracleApp,
      dePoolApp,
      spRegistryApp
    }
  }
}
exports.prepareContext = prepareContext

const loadDepositData = (dir, index = 0) => {
  const depositDataFiles = fs.readdirSync(dir).filter((file) => {
    return file.indexOf('.') !== 0 && file.match(/deposit_data.+\.json$/i)
  })
  if (!depositDataFiles.length) {
    throw new Error('No deposit_data files found')
  }
  return require(`${dir}/${depositDataFiles[index]}`)
}
exports.loadDepositData = loadDepositData

