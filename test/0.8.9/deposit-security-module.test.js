const { assertRevert } = require('@aragon/contract-helpers-test/src/asserts')
const { assert } = require('chai')

const DepositSecurityModule = artifacts.require('DepositSecurityModule.sol')
const LidoMockForDepositSecurityModule = artifacts.require('LidoMockForDepositSecurityModule.sol')
const NodeOperatorsRegistryMockForSecurityModule = artifacts.require('NodeOperatorsRegistryMockForSecurityModule.sol')
const DepositContractMockForDepositSecurityModule = artifacts.require('DepositContractMockForDepositSecurityModule.sol')

const MAX_DEPOSITS_PER_BLOCK = 100

contract('DepositSecurityModule', ([owner, stranger]) => {
  let depositSecurityModule, depositContractMock, lidoMock, nodeOperatorsRegistryMock
  beforeEach('deploy DepositSecurityModule', async () => {
    lidoMock = await LidoMockForDepositSecurityModule.new()
    nodeOperatorsRegistryMock = await NodeOperatorsRegistryMockForSecurityModule.new()
    depositContractMock = await DepositContractMockForDepositSecurityModule.new()
    depositSecurityModule = await DepositSecurityModule.new(
      lidoMock.address,
      depositContractMock.address,
      nodeOperatorsRegistryMock.address,
      { from: owner }
    )

    await depositSecurityModule.setMaxDeposits(MAX_DEPOSITS_PER_BLOCK, { from: owner })
  })

  it('deposits are impossible when total_guardian=0 and quorum=0', async () => {
    const maxDeposits = 24
    const depositRoot = '0xd151867719c94ad8458feaf491809f9bc8096c702a72747403ecaac30c179137'
    const keysOpIndex = 10

    await nodeOperatorsRegistryMock.setKeysOpIndex(keysOpIndex)
    assert.equal(await nodeOperatorsRegistryMock.getKeysOpIndex(), keysOpIndex, 'invariant failed: keysOpIndex')

    await depositContractMock.set_deposit_root(depositRoot)
    assert.equal(await depositContractMock.get_deposit_root(), depositRoot, 'invariant failed: depositRoot')

    const guardians = await depositSecurityModule.getGuardians()
    assert.equal(guardians.length, 0, 'invariant failed: guardians != 0')

    const quorum = await depositSecurityModule.getGuardianQuorum()
    assert.equal(quorum, 0, 'invariant failed: quorum != 0')

    assertRevert(
      depositSecurityModule.depositBufferedEther(maxDeposits, depositRoot, keysOpIndex, '0x', { from: stranger }),
      'no guardian quorum'
    )
  })
})
