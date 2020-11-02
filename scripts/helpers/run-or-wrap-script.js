// If executed directly by Node.js, calls the passed function.
// Otherwise, returns a wrapped function that should support
// both running by Truffle and requiring by a custom code.
//
module.exports = (scriptFn, mainModule) => {
  if (require.main === mainModule) {
    // Buidler executes scripts in a forked subprocess
    scriptFn()
      .then(() => {
        console.log('All done!')
        process.exit(0)
      })
      .catch((err) => {
        console.log(err.stack)
        process.exit(2)
      })
    return undefined
  } else {
    return (callback, opts) => {
      if (typeof callback === 'function') {
        // Truffle requires scripts and uses a callback
        scriptFn(opts)
          .then(() => callback())
          .catch(callback)
      } else {
        // Otherwise, just return the Promise, allowing to pass opts as a single arg
        return scriptFn(opts || callback)
      }
    }
  }
}
