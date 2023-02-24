const hre = require('hardhat')
const { ZERO_ADDRESS } = require('../constants')

class GenericStub {
  static LOG_TYPE = Object.freeze({
    LOG0: 0,
    LOG1: 1,
    LOG2: 2,
    LOG3: 3,
    LOG4: 4,
  })

  static GenericStubContract = hre.artifacts.require('GenericStub')

  static async new(contractName) {
    const stubInstance = await GenericStub.GenericStubContract.new()
    const StubbedContractFactory = hre.artifacts.require(contractName)
    return StubbedContractFactory.at(stubInstance.address)
  }

  static async addState(stubbedContract) {
    const stubInstance = await GenericStub.GenericStubContract.at(stubbedContract.address)
    await stubInstance.GenericStub__addState()
  }

  static async setState(stubbedContract, stateIndex) {
    const stubInstance = await GenericStub.GenericStubContract.at(stubbedContract.address)
    await stubInstance.GenericStub__setState(stateIndex)
  }

  /**
   * @typedef {object} TypedTuple - stores a info about tuple type & value
   * @property {string[]} - tuple with type names
   * @property {any[]} - tuple with values for types
   *
   * @param {object} stubbedContract instance of the GenericStub contract to add stub
   *
   * @param {string} methodName name of the method to stub
   *
   * @param {object} config stubbed method params
   * @param {TypedTuple} [config.input] the input value to trigger the stub
   * @param {TypedTuple} [config.return] the output value to return or revert from stub
   * @param {object} [config.revert] the revert info when stub must finish with error
   * @param {string} [config.revert.reason] the revert reason. Used when method reverts with string message
   * @param {string} [config.revert.error] the custom error name when method must revert with custom error
   * @param {TypedTuple} [config.revert.args] the arguments info for custom error
   * @param {object} [config.forwardETH] amount and recipient where to send ETH
   * @param {string} config.forwardETH.recipient recipient address of the ETH
   * @param {object} config.forwardETH.value amount of ETH to send
   * @param {number} [config.nextState] one based state index to set after stub call
   * @param {object[]} [config.emit] events to emit when stub called
   * @param {string} config.emit.name name of the event to emit
   * @param {object} [config.emit.args] arguments of the event
   * @param {string[]} [config.emit.args.type] tuple with type names
   * @param {any[]} [config.emit.args.value] tuple with values for types
   * @param {bool[]} [config.emit.args.indexed] is value indexed or not
   */
  static async stub(stubbedContract, methodName, config = {}) {
    const stubInstance = await GenericStub.GenericStubContract.at(stubbedContract.address)

    const { abi: abis } = stubbedContract
    const methodAbis = abis.filter((abi) => abi.type === 'function' && abi.name === methodName)

    if (methodAbis.length > 1) {
      throw new Error('Support of methods overloading has not implemented yet')
    }
    const [methodAbi] = methodAbis

    const configParser = new GenericStubConfigParser()
    const parsedConfig = configParser.parse(methodAbi.signature, config)
    await stubInstance.GenericStub__addStub(Object.values(parsedConfig))
  }
}

module.exports = {
  GenericStub,
}

class GenericStubConfigParser {
  parse(methodAbi, config) {
    return {
      input: this._parseInput(methodAbi, config),
      output: this._parseOutput(config),
      logs: this._parseLogs(config),
      forwardETH: this._parseForwardETH(config),
      isRevert: this._parseIsRevert(config),
      nextState: this._parseNextState(config),
    }
  }

  _parseInput(methodSignature, config) {
    return methodSignature + this._encode(config.input || { type: [], value: [] }).slice(2)
  }

  _parseOutput(config) {
    if (config.return) {
      return this._encode(config.return)
    }
    if (config.revert) {
      return config.revert.error
        ? this._encodeError(config.revert.error)
        : this._encodeError({ error: 'Error', args: { type: ['string'], value: [config.revert.reason || ''] } })
    }
    return this._encode({ type: [], value: [] })
  }

  _parseLogs(config) {
    if (!config.emit || config.emit.length === 0) return []
    return config.emit.map((event) => {
      // required field so just read it
      const name = event.name
      // if not passed event considered as without arguments
      const args = event.args ? { type: event.args.type, value: event.args.value } : { type: [], value: [] }
      // when indexed is passed take its values or consider all fields as non-indexed in other cases
      const indexed = event.args && event.args.indexed ? event.args.indexed : args.value.map(() => false)
      // filter all indexed args indices to pass them as topics
      const indexedIndices = indexed.map((indexed, index) => (indexed ? index : -1)).filter((i) => i >= 0)
      // filter all non-indexed args indices to pass them as data
      const nonIndexedIndices = indexed.map((indexed, index) => (indexed ? -1 : index)).filter((i) => i >= 0)

      // signature of the event always goes as topic1
      const signature = this._eventSignature(name, args.type)
      // collect argument into topics via ABI encoding
      const topics = indexedIndices.map((i) => this._encode({ type: [args.type[i]], value: [args.value[i]] }))
      // collect non-indexed args to encode them via ABI encoder and use it as data
      const nonIndexedArgs = nonIndexedIndices
        .map((i) => [args.type[i], args.value[i]])
        .reduce((args, [type, value]) => ({ type: [...args.type, type], value: [...args.value, value] }), {
          type: [],
          value: [],
        })

      const logType = topics.length + 1 // first topic is event signature
      return [
        logType,
        this._encode(nonIndexedArgs),
        signature,
        logType >= 2 ? topics[0] : '0x0',
        logType >= 3 ? topics[1] : '0x0',
        logType === 4 ? topics[2] : '0x0',
      ]
    })
  }

  _parseForwardETH(config) {
    const { forwardETH = { recipient: ZERO_ADDRESS, value: 0 } } = config
    return [forwardETH.recipient, forwardETH.value]
  }

  _parseIsRevert(config) {
    return !!config.revert
  }

  _parseNextState(config) {
    return config.nextState || 0
  }

  _encode({ type, value }) {
    return hre.ethers.utils.defaultAbiCoder.encode(type, value)
  }

  _encodeError({ error, args }) {
    const signature = this._errorSignature(error, args.type)
    return signature + this._encode(args).slice(2)
  }

  _errorSignature(name, argTypes) {
    const fullName = `${name}(${argTypes.join(',')})`
    return hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(fullName)).slice(0, 10)
  }

  _eventSignature(name, argTypes) {
    const fullName = `${name}(${argTypes.join(',')})`
    return hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(fullName))
  }
}
