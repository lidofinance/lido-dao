const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')
const { getAllApps, getDaoAddress } = require('@aragon/toolkit')

const { STETH_APP_ID } = require('./helpers/apps')
const runOrWrapScript = require('./helpers/run-or-wrap-script')
const logDeploy = require('./helpers/log-deploy')
const { errorOut } = require('./helpers')
const { daoName } = require('./helpers/constants')

const globalArtifacts = this.artifacts || artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 || web3 // Not injected unless called directly via truffle

const aragonTld = `aragonid.eth`
const daoTld = `${daoName}.${aragonTld}`

const defaultOwner = process.env.OWNER
const defaultENSAddress = process.env.ENS || '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'

async function deploy({
  artifacts = globalArtifacts,
  web3 = globalWeb3,
  ensAddress = defaultENSAddress,
  owner = defaultOwner,
  verbose = true
} = {}) {
  const log = (...args) => {
    if (verbose) {
      console.log(...args)
    }
  }

  if (!web3)
    errorOut('Missing "web3" object. This script must be run with a "web3" object globally defined, for example through "truffle exec".')
  if (!artifacts)
    errorOut(
      'Missing "artifacts" object. This script must be run with an "artifacts" object globally defined, for example through "truffle exec".'
    )
  if (!ensAddress) errorOut('Missing ENS address. Please specify one using ENS env var')

  const [holder1] = await getAccounts(web3)
  if (!owner) {
    owner = holder1
    log("OWNER env variable not found, setting owner to the provider's first account")
  }
  log('Owner:', owner)

  const CstETH = artifacts.require('CstETH')
  const daoAddress = await getDaoAddress(daoTld, {
    provider: web3.currentProvider,
    registryAddress: ensAddress
  })
  const installedApps = await getAllApps(daoAddress, { web3 })
  const stEthApp = installedApps.find((a) => a.appId === STETH_APP_ID)
  const cstEth = await CstETH.new(stEthApp.proxyAddress)
  await logDeploy('CstETH', cstEth)

  return {
    cstEth: cstEth.address
  }
}

module.exports = runOrWrapScript(deploy, module)
