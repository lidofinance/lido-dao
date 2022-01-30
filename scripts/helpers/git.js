const path = require('path')
const { execLive } = require('./exec')
const { directoryExists } = require('./fs')

async function gitCloneRepo(targetPath, repoLink, gitRef) {
  const targetAbsPath = path.resolve(targetPath)
  if (!(await directoryExists(targetAbsPath))) {
    await execLive('git', { args: ['clone', repoLink, targetAbsPath] })
  }
  await execLive('git', { args: ['reset', '--hard'], cwd: targetAbsPath })
  await execLive('git', { args: ['checkout', gitRef], cwd: targetAbsPath })
}

module.exports = { gitCloneRepo }
