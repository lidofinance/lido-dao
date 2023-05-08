module.exports = {
  // todo: add support for '**/test_helpers' globs
  skipFiles: ['0.4.24/template', '0.4.24/test_helpers', '0.4.24/nos/test_helpers', '0.6.12/mocks', '0.8.9/test_helpers'],
  mocha: {
    enableTimeouts: false
  }
}
