const hre = require('hardhat')

const MAX_UINT256 = BigInt(2n ** 256n - 1n).toString()
const EMPTY_FRAME_ID = MAX_UINT256
const GET_STORAGE_ADDRESS_METHOD_ID = '0x00000001'

const ContractStubStorage = hre.artifacts.require('ContractStubStorage')

function ContractStub(artifact) {
  return new ContractStubBuilder(artifact)
}

function isTruffleContractName(maybeContractName) {
  return typeof maybeContractName === 'string'
}

function isTruffleContractFactory(maybeContractFactory) {
  return typeof maybeContractFactory.new === 'function'
}

function isTruffleContractInstance(maybeContractInstance) {
  return (
    typeof maybeContractInstance.constructor === 'function' &&
    isTruffleContractFactory(maybeContractInstance.constructor)
  )
}

function prepareTruffleArtifact(artifact) {
  if (isTruffleContractName(artifact)) return { factory: hre.artifacts.require(artifact), instance: undefined }
  if (isTruffleContractFactory(artifact)) return { factory: artifact, instance: undefined }
  if (isTruffleContractInstance(artifact)) return { factory: artifact.constructor, instance: artifact }
  throw new Error(`Unexpected artifact value "${artifact}"`)
}

class ContractStubBuilder {
  constructor(truffleArtifact) {
    this._artifact = prepareTruffleArtifact(truffleArtifact)
    this._methodNames = []
    this._stubBuildSteps = []
    this._currentFrame = EMPTY_FRAME_ID
  }

  async create(txDetails) {
    if (!this._artifact.instance) {
      const stub = await hre.artifacts.require('ContractStub').new(GET_STORAGE_ADDRESS_METHOD_ID, txDetails)
      this._artifact.instance = await this._artifact.factory.at(stub.address)
    }
    return this._stub(txDetails)
  }

  async update(txDetails) {
    await this._stub(txDetails)
  }

  /**
   * Stubs the method call
   *
   * @typedef {number | string | BN | BigInt } Numberable
   *
   * @typedef {Object} TypedTupleConfig - stores typed tuple value
   * @property {string[]} type - types of the tuple elements
   * @property {unknown[]} value - values of the tuple elements
   *
   * @typedef {Object} CustomErrorConfig - describes the custom error to revert with
   * @property {string} name - the name of the error
   * @property {TypedTupleConfig} args - the arguments of the error
   *
   * @typedef {Object} EventArgsConfig
   * @property {string[]} type - types of the event arguments
   * @property {unknown[]} value - values of the event arguments
   * @property {boolean[]} indexed - array with flag whether the arg is indexed or not
   *
   * @typedef {Object} RevertConfig - describes the value to revert with
   * @property {string=} reason - the error message to revert with
   * @property {CustomErrorConfig=} error - the custom error to revert with
   *
   * @typedef {Object} ForwardETHConfig - the info about unconditional (even if recipient is not payable)
   *   ETH forwarding from the stub contract
   * @property {string} recipient - address to forward ETH from the stub contract
   * @property {Numberable} value - the amount of ETH to forward
   *
   * @typedef {Object} CallConfig - low level call method params
   * @property {string} callee - address of the account to call
   * @property {string=} data - msg.data to pass on call. By default no data passed
   * @property {Numberable=} value - the amount of ETH to send with call. By default is 0.p
   * @property {Numberable=} gas - the gas limit for the call. By default uses all gas
   *
   * @typedef {Object} EventConfig - the config of the event
   * @property {string} name - name of the event
   * @property {EventArgsConfig} args - arguments of the event
   *
   * @typedef {Object} MethodStubConfig
   * @property {TypedTupleConfig=} input - when passed, stub will be triggered only when method is called
   *   with data matched input. When omitted, stub will be triggered for any call to method
   * @property {TypedTupleConfig=} return - the value to return when stub is called
   * @property {RevertConfig=} revert - the error to revert with when stub is called
   * @property {ForwardETHConfig[]=} ethForwards - the info about unconditional (even if recipient
   *   is not payable) ETH forwarding from the stub contract
   * @property {boolean=} traceable - whether to emit event on stub call. The default value is false
   * @property {number=} nextFrame - the frame to set as active when the stub will be called.
   *   If not passed ContractStub stays in the same frame.
   * @property {CallConfig[]=} calls - the list of external calls to make from method stub when it's triggered
   * @property {EventConfig[]=} emits - the list of events to emit from method stub when it's triggered
   *
   * @param {string} methodName - name of the method to stub
   * @param {MethodStubConfig} config - config of the method stub
   */
  on(methodName, config = {}) {
    this._methodNames.push(methodName)
    this._stubBuildSteps.push({ currentFrame: this._currentFrame, ...config })
    return this
  }

  /**
   * Sets the active frame of the contract stub
   *
   * @param {number} frame - the number of the frame to set as active
   */
  frame(frame) {
    this._currentFrame = frame
    return this
  }

  async _stub(txDetails) {
    for (let i = 0; i < this._methodNames.length; ++i) {
      await this._stubMethod(
        await this._getContractStubStorage(this._artifact.instance),
        this._artifact.instance.abi,
        this._methodNames[i],
        this._stubBuildSteps[i],
        txDetails
      )
    }

    return this._artifact.instance
  }

  async _stubMethod(contractStubStorage, abi, methodName, config, txDetails) {
    const configParser = new ContractStubConfigParser()
    const { currentFrame, stub } = configParser.parse(this._getMethodSignature(abi, methodName), config)
    await contractStubStorage.addMethodStub(currentFrame, stub, txDetails)
  }

  _getMethodSignature(abi, methodName) {
    if (methodName === 'receive') return '0x'
    const methodAbi = abi.filter((abi) => abi.type === 'function' && abi.name === methodName)

    if (methodAbi.length > 1) {
      throw new Error('Support of methods overloading has not implemented yet')
    }
    return methodAbi[0].signature
  }

  async _getContractStubStorage(stubInstance) {
    const storageAddress = await hre.web3.eth.call({
      to: stubInstance.address,
      data: GET_STORAGE_ADDRESS_METHOD_ID,
    })
    return ContractStubStorage.at(storageAddress)
  }
}

class TypedTuple {
  constructor(type, value) {
    this.type = type
    this.value = value
  }

  static empty() {
    return new TypedTuple([], [])
  }

  static seed(type, value) {
    return new TypedTuple([type], [value])
  }

  static create(type, value) {
    return new TypedTuple(type, value)
  }

  append(type, value) {
    this.type.push(type)
    this.value.push(value)
    return this
  }
}

const EMPTY_TYPED_TUPLE = Object.freeze(TypedTuple.empty())

class ContractStubConfigParser {
  parse(methodSignature, config) {
    return {
      currentFrame: this._parseCurrentFrame(config),
      stub: [
        this._parseInput(methodSignature, config),
        this._parseOutput(config),
        this._parseIsRevert(config),
        [
          this._parseTraceable(config),
          this._parseNextFrame(config),
          this._parseLogs(config),
          this._parseCalls(config),
          this._parseETHForwards(config),
        ],
      ],
    }
  }

  _parseInput(methodSignature, config) {
    return methodSignature + this._encode(config.input || EMPTY_TYPED_TUPLE).slice(2)
  }

  _parseOutput(config) {
    if (config.return) {
      return this._encode(config.return)
    } else if (config.revert && config.revert.reason === 'outOfGas') {
      return this._encode(EMPTY_TYPED_TUPLE)
    } else if (config.revert && config.revert.reason !== undefined) {
      return this._encodeError({ name: 'Error', args: TypedTuple.create(['string'], [config.revert.reason]) })
    } else if (config.revert && config.revert.error) {
      return this._encodeError(config.revert.error)
    }
    return this._encode(EMPTY_TYPED_TUPLE)
  }

  _parseLogs(config) {
    if (!config.emits || config.emits.length === 0) return []
    return config.emits.map((emitConfig) => {
      // required field so just read it
      const name = emitConfig.name
      // if not passed event considered as without arguments
      const args = emitConfig.args
        ? { type: emitConfig.args.type, value: emitConfig.args.value }
        : { type: [], value: [] }
      // when indexed is passed take its values or consider all fields as non-indexed in other cases
      const indexed = emitConfig.args && emitConfig.args.indexed ? emitConfig.args.indexed : args.value.map(() => false)
      // filter all indexed args indices to pass them as topics
      const indexedIndices = indexed.map((indexed, index) => (indexed ? index : -1)).filter((i) => i >= 0)
      // filter all non-indexed args indices to pass them as data
      const nonIndexedIndices = indexed.map((indexed, index) => (indexed ? -1 : index)).filter((i) => i >= 0)

      // signature of the event always goes as topic1
      const signature = this._eventSignature(name, args.type)
      // collect argument into topics via ABI encoding
      const topics = indexedIndices.map((i) => this._encode(TypedTuple.seed(args.type[i], args.value[i])))
      // collect non-indexed args to encode them via ABI encoder and use it as data
      const nonIndexedArgs = nonIndexedIndices
        .map((i) => [args.type[i], args.value[i]])
        .reduce((args, [type, value]) => args.append(type, value), TypedTuple.empty())

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

  _parseETHForwards(config) {
    return (config.ethForwards || []).map((forward) => [forward.recipient, forward.value.toString()])
  }

  _parseIsRevert(config) {
    return !!config.revert
  }

  _parseNextFrame(config) {
    return config.nextFrame ?? EMPTY_FRAME_ID
  }

  _parseCurrentFrame(config) {
    return config.currentFrame ?? EMPTY_FRAME_ID
  }

  _parseTraceable(config) {
    return config.traceable ?? false
  }

  _parseCalls(config) {
    return (config.calls ?? []).map((call) => [call.callee, call.data ?? '0x', call.value ?? 0, call.gas ?? 0])
  }

  _encode(args) {
    return hre.ethers.utils.defaultAbiCoder.encode(args.type, args.value)
  }

  _encodeError(error) {
    const args = error.args ?? EMPTY_TYPED_TUPLE
    const signature = this._errorSignature(error.name, args.type)
    return signature + this._encode(args).slice(2)
  }

  _errorSignature(name, argTypes) {
    const fullName = `${name}(${argTypes.join(',')})`
    return hre.web3.utils.soliditySha3(fullName).slice(0, 10)
  }

  _eventSignature(name, argTypes) {
    const fullName = `${name}(${argTypes.join(',')})`
    return hre.web3.utils.soliditySha3(fullName)
  }
}

module.exports = { ContractStub, ContractStubBuilder }
