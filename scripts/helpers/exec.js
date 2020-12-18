const childProcess = require('child_process')

const { log } = require('./log')

function exec(cmdWithArgs, opts = {}) {
  log((opts.cwd ? `+ cd ${opts.cwd} && ` : '+ ') + cmdWithArgs)
  return new Promise((resolve, reject) => {
    childProcess.exec(cmdWithArgs, opts, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

function execLive(cmd, { args, cwd, env }) {
  return new Promise((resolve, reject) => {
    args = args || []
    const argsDesc = args.length ? ' ' + args.map((a) => (a === '' ? "''" : a)).join(' ') : ''
    log(`+ cd ${cwd || process.cwd()} && ${cmd}${argsDesc}`)
    const proc = childProcess.spawn(cmd, args, { cwd, env, stdio: 'inherit' })
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

module.exports = { exec, execLive }
