const fs = require('fs')
const path = require('path')
const { network } = require('hardhat')
const { hash: namehash } = require('eth-ens-namehash')
const buidlerTaskNames = require('@nomiclabs/buidler/builtin-tasks/task-names')
const hardhatTaskNames = require('hardhat/builtin-tasks/task-names')

const { log, logSplitter, logHeader, yl } = require('./log')
const { exec, execLive } = require('./exec')
const { readJSON } = require('./fs')

// this is needed for the next two `require`s to work, some kind of typescript path magic
require('@aragon/buidler-aragon/dist/bootstrap-paths')

const { generateArtifacts } = require('@aragon/buidler-aragon/dist/src/utils/artifact/generateArtifacts')
const { toContentUri } = require('@aragon/buidler-aragon/dist/src/utils/apm/utils')

const APPS_DIR_PATH = process.env.APPS_DIR_PATH || path.resolve(process.cwd(), 'apps')
const LIDO_APM_ENS_NAME = 'lidopm.eth'

async function buildAragonAppFrotnend(
  artifacts,
  appDir,
  appsDirPath = APPS_DIR_PATH,
  lidoApmEnsName = LIDO_APM_ENS_NAME,
  forceRebuild = false
) {
  logHeader(`Building frontend for app '${appDir}'`)

  const appRootPath = path.resolve(appsDirPath, appDir)
  const { appFullName, contractPath } = await readArappJSON(appRootPath, network.name)
  const appName = appFullName.substring(0, appFullName.indexOf('.'))

  log(`App UI dir:`, yl(appRootPath))
  log(`App name: ${yl(appName)}`)
  log(`App full name: ${yl(appFullName)}`)

  if (!appFullName.endsWith('.' + lidoApmEnsName)) {
    throw new Error(`app full name is not a subdomain of the Lido APM ENS domain ${lidoApmEnsName}`)
  }

  const appId = namehash(appFullName)
  log(`App ID: ${yl(appId)}`)

  logSplitter()
  log(`Building app's frontend...`)

  const distPath = path.join(appRootPath, 'dist')
  if (!fs.existsSync(distPath) || forceRebuild) {
    logSplitter()
    log('Removing output directory...')
    await exec(`rm -rf ${distPath}`)

    await execLive('yarn', {
      args: ['build'],
      cwd: path.join(appRootPath, 'app'),
    })
  } else {
    log(yl('[!] Output dir exists - skip'))
  }

  logSplitter()
  log('Generating artifacts...')

  process.chdir(appRootPath)

  const wrappedRun = async (taskName, ...args) => {
    if (taskName !== buidlerTaskNames.TASK_FLATTEN_GET_FLATTENED_SOURCE) {
      return await run(taskName)
    }
    // buidler-aragon tries to get flattened source code of all contracts and fails to
    // parce Solidity syntax newer than 0.4 (which we have in non-Aragon contracts), so
    // here we're flattening only the app's dependency graph instead
    return await run(hardhatTaskNames.TASK_FLATTEN_GET_FLATTENED_SOURCE, {
      files: [contractPath],
    })
  }

  const bre = { artifacts, network, run: wrappedRun }
  await generateArtifacts(distPath, bre)

  logSplitter()

  log(`App 'dist' dir: ${yl(distPath)}`)

  const { stdout } = await exec(`ipfs add -Qr --only-hash ${distPath}`)
  const ipfsCid = stdout.trim()
  const contentURI = toContentUri('ipfs', ipfsCid)
  log(`App IPFS CID: ${yl(ipfsCid)}`)
  log(`App content URI: ${yl(contentURI)}`)
  return { ipfsCid, contentURI }
}

async function readArappJSON(appRoot, netName) {
  const arappJSON = await readJSON(path.join(appRoot, 'arapp.json'))
  const appFullName = getAppName(arappJSON, netName)
  const contractPath = path.resolve(appRoot, arappJSON.path)
  return { appFullName, contractPath }
}

function getAppName(arappJSON, netName) {
  const { environments } = arappJSON
  if (!environments) {
    return null
  }
  if (environments[netName]) {
    // NOTE: assuming that Aragon environment is named after the network
    return environments[netName].appName
  }
  return (environments.default || {}).appName || null
}

module.exports = {
  APPS_DIR_PATH,
  LIDO_APM_ENS_NAME,
  buildAragonAppFrotnend,
}
