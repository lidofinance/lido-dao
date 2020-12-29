module.exports = {
  skipFiles: ['0.4.24/template', '0.4.24/nos/test_helpers',
    '0.4.24/oracle/test_helpers', '0.4.24/test_helpers',
    '0.6.12/mocks', '0.6.11/deposit_contract.sol'],
  providerOptions: {
    default_balance_ether: 10000,
    gasPrice: '0x1',
  },
}
