const fs = require('fs')
const path = require('path')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logWideSplitter, yl } = require('../helpers/log')

const { buildAragonAppFrotnend, APPS_DIR_PATH, LIDO_APM_ENS_NAME } = require('../helpers/aragonApp')

const APPS = process.env.APPS || '*'

async function buildAppFrontends({ web3, artifacts, appsDirPath = APPS_DIR_PATH, appDirs = APPS }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID: ${yl(netId)}`)

  appsDirPath = path.resolve(appsDirPath)

  if (appDirs && appDirs !== '*') {
    appDirs = appDirs.split(',')
  } else {
    appDirs = fs.readdirSync(appsDirPath)
  }

  const cwd = process.cwd()

  for (const appDir of appDirs) {
    try {
      await buildAragonAppFrotnend(artifacts, appDir, appsDirPath, LIDO_APM_ENS_NAME)
    } finally {
      process.chdir(cwd)
    }
  }
}

module.exports = runOrWrapScript(buildAppFrontends, module)
