module.exports = {
  istanbulReporter: ['html', 'text', 'cobertura'],
  // NOTE: those is are all relative paths to the `contracts` directory and does not support regex
  //       https://github.com/sc-forks/solidity-coverage/issues/632#issuecomment-1736629543
  skipFiles: [
    '0.4.24/template',
    '0.4.24/test_helpers',
    '0.6.11/deposit_contract.sol',
    '0.6.12/interfaces',
    '0.6.12/mocks',
    '0.8.9/interfaces',
    '0.8.9/test_helpers',
    'common/interfaces',
    'common/test_helpers',
  ]
}
