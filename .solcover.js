module.exports = {
  istanbulReporter: ['html', 'text', 'cobertura'],
  // REVIEW: Do we need to skip only those? Do we need to skip anything at all?
  skipFiles: [
    '0.4.24/test_helpers',
    '0.6.12/mocks',
    '0.8.9/test_helpers',
    'common/test_helpers'
  ]
}
