const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { getEventArgument, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')

const { pad, ETH, hexConcat, toBN } = require('./test/helpers/utils')
const { deployDaoAndPool } = require('./test/scenario/helpers/deploy')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

contract('Lido: deposit loop gas estimate', (addresses) => {
  const [
    // the root account which deployed the DAO
    appManager,
    // the address which we use to simulate the voting DAO application
    voting,
    // node operators
    nodeOperator,
    // users who deposit Ether to the pool
    user1,
    user2,
    // an unrelated address
    nobody
  ] = addresses

  let pool, nodeOperatorRegistry, validatorRegistrationMock

  const arbitraryN = toBN('0x0159e2036050fb43f6ecaca13a7b53b23ea54a623e47fb2bd89a5b4a18da3295')
  const withdrawalCredentials = pad('0x0202', 32)
  const validatorData = []

  it('DAO, node operators registry, token, and pool are deployed and initialized', async () => {
    const deployed = await deployDaoAndPool(appManager, voting, 100)

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorRegistry = deployed.nodeOperatorRegistry

    // mocks
    validatorRegistrationMock = deployed.validatorRegistrationMock

    await pool.setFee(0.01 * 10000, { from: voting })
    await pool.setFeeDistribution(0.3 * 10000, 0.2 * 10000, 0.5 * 10000, { from: voting })
    await pool.setWithdrawalCredentials(withdrawalCredentials, { from: voting })
  })

  it('voting adds 20 node operators with 3 signing keys each', async () => {
    const operatorValidatorsLimit = 1000
    const numOperators = 20
    const numKeys = 3

    for (let iOperator = 0; iOperator < numOperators; ++iOperator) {
      const txn = await nodeOperatorRegistry.addNodeOperator(`operator-${iOperator}`, nodeOperator, operatorValidatorsLimit, {
        from: voting
      })
      const nodeOperatorId = getEventArgument(txn, 'NodeOperatorAdded', 'id', { decodeForAbi: NodeOperatorsRegistry._json.abi })

      const data = Array.from({ length: numKeys }, (_, iKey) => {
        const n = arbitraryN.clone().addn(10 * iKey + 1000 * iOperator)
        return {
          key: pad(`0x${n.toString(16)}`, 48, 'd'),
          sig: pad(`0x${n.toString(16)}`, 96, 'e')
        }
      })

      const keys = hexConcat(...data.map((v) => v.key))
      const sigs = hexConcat(...data.map((v) => v.sig))

      await nodeOperatorRegistry.addSigningKeys(nodeOperatorId, numKeys, keys, sigs, { from: voting })

      const totalKeys = await nodeOperatorRegistry.getTotalSigningKeyCount(nodeOperatorId, { from: nobody })
      assertBn(totalKeys, numKeys, 'total signing keys')

      validatorData.push.apply(validatorData, data)
    }

    assertBn(await nodeOperatorRegistry.getNodeOperatorsCount(), numOperators, 'total operators')
  })

  let gasPerMockDeposit
  const gasPerNValidators = {}
  // let gasPerSingleValidator
  // let gasPerTenValidators

  it('calling ValidatorRegistrationMock.deposit multiple times', async () => {
    const results = await Promise.all(
      validatorData.map(({ key, sig }, i) =>
        validatorRegistrationMock.deposit(key, withdrawalCredentials, sig, `0x${arbitraryN.toString(16)}`, { from: user1, value: ETH(32) })
      )
    )

    assertBn(await validatorRegistrationMock.totalCalls(), validatorData.length)

    const gasUsed = results.map((r) => +r.receipt.gasUsed)
    console.log('mock deposits gas:', gasUsed.join(', '))

    const avgGasUsed = gasUsed.slice(1).reduce((a, b) => a + b, 0) / (gasUsed.length - 1)
    console.log('avg gas per mock deposit:', avgGasUsed)

    gasPerMockDeposit = avgGasUsed
  })

  it('a user sends 33 ETH', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user1, value: ETH(33) })

    assertBn(await pool.getTotalPooledEther(), ETH(33), 'total pooled ether')
    assertBn((await validatorRegistrationMock.totalCalls()) - validatorData.length, 1, 'validators registered')

    console.log('1 validator (initial), gas:', result.receipt.gasUsed)
  })

  it('a user submits 32 ETH', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user2, value: ETH(32) })

    assertBn(await pool.getTotalPooledEther(), ETH(33 + 32), 'total pooled ether')
    assertBn((await validatorRegistrationMock.totalCalls()) - validatorData.length, 2, 'validators registered')

    console.log('1 validator, gas:', result.receipt.gasUsed)

    gasPerNValidators['1'] = result.receipt.gasUsed
  })

  it('a, 1 validator user submits 5 * 32 ETH', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user2, value: ETH(5 * 32) })

    assertBn(await pool.getTotalPooledEther(), ETH(33 + 32 + 5 * 32), 'total pooled ether')
    assertBn((await validatorRegistrationMock.totalCalls()) - validatorData.length, 2 + 5, 'validators registered')

    const gasPerIter = result.receipt.gasUsed / 5

    console.log('5 validators, gas:', result.receipt.gasUsed)
    console.log('5 validators, gas per iteration:', gasPerIter)

    gasPerNValidators['5'] = result.receipt.gasUsed
  })

  it('a user submits 10 * 32 ETH', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user2, value: ETH(10 * 32) })

    assertBn(await pool.getTotalPooledEther(), ETH(33 + 32 + 5 * 32 + 10 * 32), 'total pooled ether')
    assertBn((await validatorRegistrationMock.totalCalls()) - validatorData.length, 2 + 5 + 10, 'validators registered')

    const gasPerIter = result.receipt.gasUsed / 10

    console.log('10 validators, gas:', result.receipt.gasUsed)
    console.log('10 validators, gas per iteration:', gasPerIter)

    gasPerNValidators['10'] = result.receipt.gasUsed
  })

  it('a user submits 30 * 32 ETH', async () => {
    const result = await pool.submit(ZERO_ADDRESS, { from: user2, value: ETH(30 * 32) })

    assertBn(await pool.getTotalPooledEther(), ETH(33 + 32 + 5 * 32 + 10 * 32 + 30 * 32), 'total pooled ether')
    assertBn((await validatorRegistrationMock.totalCalls()) - validatorData.length, 2 + 5 + 10 + 30, 'validators registered')

    const gasPerIter = result.receipt.gasUsed / 30

    console.log('30 validators, gas:', result.receipt.gasUsed)
    console.log('30 validators, gas per iteration:', gasPerIter)

    gasPerNValidators['30'] = result.receipt.gasUsed
  })

  it('estimating gas usage', () => {
    // As you can see from the test output, the growth of gas usage is near-linear,
    // but this usage is not proportional to the iteration count. Given this, we assume
    // that gas cost consists of two components: the constant one, gasConst, and the
    // one proportional to the number of iterations with coefficient gasPerIter:
    //
    // gasConst + nIter * gasPerIter = gasPerSubmit
    //
    // Now we can calculate these components:
    //
    // gasConst + 1 * gasPerIter = gasPerSingleValidator
    // gasConst + 10 * gasPerIter = gasPerTenValidators
    //   =>
    // gasPerIter = (gasPerTenValidators - gasPerSingleValidator) / 9
    // gasConst = gasPerSingleValidator - gasPerIter
    //
    // Given that we're performing mock deposits here which take significantly
    // more gas that real deposits (which take approx. 70k gas), we need to correct
    // for that:
    //
    // gasPerIterCorrected = gasPerIter - gasPerMockDeposit + gasPerRealDeposit
    //
    const gasPerIter = Math.floor((gasPerNValidators['10'] - gasPerNValidators['1']) / 9)
    const gasConst = Math.floor(gasPerNValidators['1'] - gasPerIter)

    const gasPerRealDeposit = 70000
    const gasPerIterCorrected = gasPerIter - gasPerMockDeposit + gasPerRealDeposit

    console.log(`\n>> gasConst: ${gasConst}`)
    console.log(`>> gasPerIterCorrected: ${gasPerIterCorrected}`)
    console.log(`>> gasPerSubmit(n * 32 ETH): gasConst + n * gasPerIterCorrected\n`)

    const predictedGasPer5 = gasConst + 5 * gasPerIter
    const predictedGasPer30 = gasConst + 30 * gasPerIter

    const diff5 = Math.floor(Math.abs(predictedGasPer5 - gasPerNValidators['5']) / 5)
    const diff30 = Math.floor(Math.abs(predictedGasPer30 - gasPerNValidators['30']) / 30)

    console.log(`predicted gas per 5 val, w/mock: ${predictedGasPer5}, actual: ${gasPerNValidators['5']}, diff/iter: ${diff5}`)
    console.log(`predicted gas per 30 val, w/mock: ${predictedGasPer30}, actual: ${gasPerNValidators['30']}, diff/iter: ${diff30}\n`)

    const blockGasLimit = 12000000
    const targetBlockFraction = 0.2
    const targetMaxGas = Math.floor(blockGasLimit * targetBlockFraction)
    const iterLimit = Math.floor((targetMaxGas - gasConst) / gasPerIterCorrected)

    console.log(`>> blockGasLimit: ${blockGasLimit}`)
    console.log(`>> targetMaxGas (${Math.floor(100 * targetBlockFraction)}% of a block): ${targetMaxGas}`)
    console.log(`>> iterLimit: ${iterLimit}\n`)
  })
})
