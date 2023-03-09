const { GenericStub } = require('./generic.stub')
const { FakeValidatorKeys } = require('../../helpers/signing-keys')

class StakingModuleStub extends GenericStub {
  static new() {
    return GenericStub.new('IStakingModule')
  }

  static async stubGetStakingModuleSummary(
    stakingModuleStub,
    { totalExitedValidators, totalDepositedValidators, depositableValidatorsCount },
    configOverrides = {}
  ) {
    await GenericStub.stub(stakingModuleStub, 'getStakingModuleSummary', {
      return: {
        type: ['uint256', 'uint256', 'uint256'],
        value: [totalExitedValidators, totalDepositedValidators, depositableValidatorsCount],
      },
      ...configOverrides,
    })
  }

  /**
   * @param {object} stakingModuleStub instance of GenericStub contract
   * @param {object} config config for the method stub
   * @param {object} config.input the input stub must return value for. When not set
   *    config.return value will be returned for any input
   * @param {number} config.input.depositsCount the input value of the _depositsCount to trigger stub
   * @param {string} config.input.calldata the input value of the _calldata to trigger stub
   * @param {object} config.return the config for the return value
   * @param {object} config.return.depositData the instance of the FakeValidatorKeys to return from the stub.
   *    If not set will be used FakeValidatorKeys instance of default length
   * @param {number} config.return.depositDataLength the length of the FakeValidatorKeys instance
   *    to use for return value
   * @param {string} config.return.publicKeysBatch the bytes batch of the public keys
   * @param {string} config.return.signaturesBatch the bytes batch of the signatures
   */
  static async stubObtainDepositData(stakingModuleStub, config) {
    const input = config.input
      ? { type: ['uint256', 'bytes'], value: [config.input.depositsCount, config.input.calldata] }
      : undefined
    const depositData = config.return.depositData
      ? config.return.depositData
      : new FakeValidatorKeys(config.return.depositDataLength)
    const [defaultPublicKeysBatch, defaultSignaturesBatch] = depositData.slice()
    await GenericStub.stub(stakingModuleStub, 'obtainDepositData', {
      input,
      return: {
        type: ['bytes', 'bytes'],
        value: [
          config.return.publicKeysBatch || defaultPublicKeysBatch,
          config.return.signaturesBatch || defaultSignaturesBatch,
        ],
      },
    })
  }
}

module.exports = {
  StakingModuleStub,
}
