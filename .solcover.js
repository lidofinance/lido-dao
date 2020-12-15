module.exports = {
  skipFiles: ['template', 'test_helpers', 'oracle/test_helpers', 'nos/test_helpers', 'mocks'],
  providerOptions: {
    default_balance_ether: 10000,
    gasPrice: '0x1',
  },
}
