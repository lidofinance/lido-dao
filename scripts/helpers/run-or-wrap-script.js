const chalk = require('chalk')

const globalArtifacts = this.artifacts || global.artifacts
const globalWeb3 = this.web3 || global.web3

const NOT_OK = chalk.red('✗')

// If executed directly by Node.js, calls the passed function.
// Otherwise, returns a wrapped function that should support
// both running by Truffle and requiring by a custom code.
//
module.exports = (scriptFn, mainModule) => {
  if (require.main === mainModule) {
    assertGlobalAPIs()
    // Buidler executes scripts in a forked subprocess
    scriptFn({ artifacts: globalArtifacts, web3: globalWeb3 })
      .then(() => {
        console.error('All done!')
        process.exit(0)
      })
      .catch((err) => {
        if (err && err.constructor && err.constructor.name === 'AssertionError') {
          console.error(NOT_OK, err.message)
        } else {
          console.error(err.stack)
        }
        process.exit(2)
      })
    return undefined
  } else {
    return (callback, opts) => {
      if (typeof callback === 'function') {
        // Truffle requires scripts and uses a callback
        assertGlobalAPIs()
        scriptFn({ artifacts: globalArtifacts, web3: globalWeb3, ...opts })
          .then(() => callback())
          .catch(callback)
      } else {
        // Otherwise, just return the Promise, allowing to pass opts as a single arg
        return scriptFn(opts || callback)
      }
    }
  }
}

function assertGlobalAPIs() {
  if (!globalArtifacts || !globalWeb3) {
    console.error('No `web3` and/or `artifacts` global APIs provided. This script must be run through `truffle exec` or `hardhat run`')
    process.exit(1)
  }
}
