const { contract, artifacts, web3 } = require('hardhat')
const { assert } = require('../helpers/assert')

const { BN } = require('bn.js')
const { getEventArgument } = require('@aragon/contract-helpers-test')
const { gwei, ZERO_HASH, ethToGwei, pad, toBN, ETH, tokens, limitRebase } = require('../helpers/utils')
const { DSMAttestMessage, DSMPauseMessage } = require('../helpers/signatures')
const { waitBlocks, setBalance, advanceChainTime } = require('../helpers/blockchain')
const { deployProtocol } = require('../helpers/protocol')
const { setupNodeOperatorsRegistry } = require('../helpers/staking-modules')
const { calcAccountingReportDataHash, getAccountingReportDataItems } = require('../helpers/reportData')

const NodeOperatorsRegistry = artifacts.require('NodeOperatorsRegistry')

const TOTAL_BASIS_POINTS = 10 ** 4
const CURATED_MODULE_ID = 1
const LIDO_INIT_BALANCE_ETH = 1
const ONE_DAY_WITH_MARGIN = 1 * 24 * 60 * 60 + 60 * 10 // one day and 10 minutes

const ORACLE_REPORT_LIMITS_BOILERPLATE = {
  churnValidatorsPerDayLimit: 255,
  oneOffCLBalanceDecreaseBPLimit: 100,
  annualBalanceIncreaseBPLimit: 10000,
  simulatedShareRateDeviationBPLimit: 10000,
  maxValidatorExitRequestsPerReport: 10000,
  maxAccountingExtraDataListItemsCount: 10000,
  maxNodeOperatorsPerExtraDataItemCount: 10000,
  requestTimestampMargin: 0,
  maxPositiveTokenRebase: 1000000000,
}

const makeAccountingReport = ({ refSlot, numValidators, clBalanceGwei, elRewardsVaultBalance }) => ({
  refSlot,
  consensusVersion: 1,
  numValidators,
  clBalanceGwei,
  stakingModuleIdsWithNewlyExitedValidators: [],
  numExitedValidatorsByStakingModule: [],
  withdrawalVaultBalance: 0,
  elRewardsVaultBalance,
  sharesRequestedToBurn: 0,
  withdrawalFinalizationBatches: [],
  simulatedShareRate: 0,
  isBunkerMode: false,
  extraDataFormat: 0,
  extraDataHash: ZERO_HASH,
  extraDataItemsCount: 0,
})

contract('Lido: merge acceptance', (addresses) => {
  const [
    // node operators
    operator_1,
    operator_2,
    // users who deposit Ether to the pool
    user1,
    user2,
    user3,
    // unrelated address
    nobody,
  ] = addresses

  let pool, nodeOperatorsRegistry, token, oracleReportSanityChecker
  let oracleMock, depositContractMock
  let treasuryAddr, guardians, stakingRouter
  let depositSecurityModule, depositRoot
  let elRewardsVault, voting, signers
  let consensus

  // Total fee is 1%
  const totalFeePoints = 0.01 * TOTAL_BASIS_POINTS

  const withdrawalCredentials = pad('0x0202', 32)

  // Each node operator has its Ethereum 1 address, a name and a set of registered
  // validators, each of them defined as a (public key, signature) pair
  // NO with 1 validator
  const nodeOperator1 = {
    name: 'operator_1',
    address: operator_1,
    validators: [
      {
        key: pad('0x010101', 48),
        sig: pad('0x01', 96),
      },
    ],
  }

  // NO with 1 validator
  const nodeOperator2 = {
    name: 'operator_2',
    address: operator_2,
    validators: [
      {
        key: pad('0x020202', 48),
        sig: pad('0x02', 96),
      },
    ],
  }

  before('deploy base stuff', async () => {
    const deployed = await deployProtocol({
      stakingModulesFactory: async (protocol) => {
        const curatedModule = await setupNodeOperatorsRegistry(protocol)
        return [
          {
            module: curatedModule,
            name: 'Curated',
            targetShares: 10000,
            moduleFee: 500,
            treasuryFee: 500,
          },
        ]
      },
    })

    // contracts/StETH.sol
    token = deployed.pool

    // contracts/Lido.sol
    pool = deployed.pool

    // contracts/OracleReportSanityChecker.sol
    oracleReportSanityChecker = deployed.oracleReportSanityChecker

    // contracts/nos/NodeOperatorsRegistry.sol
    nodeOperatorsRegistry = deployed.stakingModules[0]

    // contracts/0.8.9/StakingRouter.sol
    stakingRouter = deployed.stakingRouter

    // mocks
    oracleMock = deployed.oracle
    depositContractMock = deployed.depositContract

    // consensus members
    signers = deployed.signers

    // addresses
    treasuryAddr = deployed.treasury.address
    depositSecurityModule = deployed.depositSecurityModule
    guardians = deployed.guardians
    elRewardsVault = deployed.elRewardsVault
    voting = deployed.voting.address
    consensus = deployed.consensusContract

    depositRoot = await depositContractMock.get_deposit_root()

    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')
    await stakingRouter.setWithdrawalCredentials(withdrawalCredentials, { from: voting })

    // Withdrawal credentials were set
    assert.equal(
      await stakingRouter.getWithdrawalCredentials({ from: nobody }),
      withdrawalCredentials,
      'withdrawal credentials'
    )

    // How many validators can this node operator register
    const validatorsLimit = 100000000
    let txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator1.name, nodeOperator1.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator1.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })
    assert.equals(nodeOperator1.id, 0, 'operator id')

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 1, 'total node operators')

    const numKeys = 1

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator1.id,
      numKeys,
      nodeOperator1.validators[0].key,
      nodeOperator1.validators[0].sig,
      {
        from: nodeOperator1.address,
      }
    )

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(0, validatorsLimit, { from: voting })

    // The key was added
    let totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    // The key was not used yet
    let unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator1.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')

    txn = await nodeOperatorsRegistry.addNodeOperator(nodeOperator2.name, nodeOperator2.address, { from: voting })

    // Some Truffle versions fail to decode logs here, so we're decoding them explicitly using a helper
    nodeOperator2.id = getEventArgument(txn, 'NodeOperatorAdded', 'nodeOperatorId', {
      decodeForAbi: NodeOperatorsRegistry._json.abi,
    })
    assert.equals(nodeOperator2.id, 1, 'operator id')

    assert.equals(await nodeOperatorsRegistry.getNodeOperatorsCount(), 2, 'total node operators')

    await nodeOperatorsRegistry.addSigningKeysOperatorBH(
      nodeOperator2.id,
      numKeys,
      nodeOperator2.validators[0].key,
      nodeOperator2.validators[0].sig,
      {
        from: nodeOperator2.address,
      }
    )

    await nodeOperatorsRegistry.setNodeOperatorStakingLimit(1, validatorsLimit, { from: voting })

    // The key was added
    totalKeys = await nodeOperatorsRegistry.getTotalSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(totalKeys, 1, 'total signing keys')

    // The key was not used yet
    unusedKeys = await nodeOperatorsRegistry.getUnusedSigningKeyCount(nodeOperator2.id, { from: nobody })
    assert.equals(unusedKeys, 1, 'unused signing keys')
  })

  it('the first user deposits 3 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user1, value: ETH(3) })
    const block = await web3.eth.getBlock('latest')
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    // No Ether was deposited yet to the validator contract
    assert.equals(await depositContractMock.totalCalls(), 0)

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 0, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // All Ether was buffered within the pool contract atm

    // The contract's balance must be non-zero. When the contract is deployed,
    // it receives LIDO_INIT_BALANCE_ETH ETH in deployProtocol() function.

    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 3), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 3), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the user
    assert.equals(await token.balanceOf(user1), tokens(3), 'user1 tokens')

    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 3), 'token total supply')
  })

  it('the second user deposits 30 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user2, value: ETH(30) })
    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    // The first 32 ETH chunk was deposited to the deposit contract,
    // using public key and signature of the only validator of the first operator

    assert.equals(await depositContractMock.totalCalls(), 1)

    const regCall = await depositContractMock.calls.call(0)
    assert.equal(regCall.pubkey, nodeOperator1.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator1.validators[0].sig)
    assert.equals(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 1, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // Some Ether remained buffered within the pool contract

    // The contract's balance must be non-zero. When the contract is deployed,
    // it receives LIDO_INIT_BALANCE_ETH ETH in deployProtocol() function.

    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 1), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 1 + 32), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assert.equals(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), tokens(30), 'user2 tokens')

    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 3 + 30), 'token total supply')
  })

  it('the third user deposits 64 ETH to the pool', async () => {
    await web3.eth.sendTransaction({ to: pool.address, from: user3, value: ETH(64) })

    const block = await waitBlocks(await depositSecurityModule.getMinDepositBlockDistance())
    const keysOpIndex = await nodeOperatorsRegistry.getKeysOpIndex()

    DSMAttestMessage.setMessagePrefix(await depositSecurityModule.ATTEST_MESSAGE_PREFIX())
    DSMPauseMessage.setMessagePrefix(await depositSecurityModule.PAUSE_MESSAGE_PREFIX())

    const validAttestMessage = new DSMAttestMessage(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex
    )
    const signatures = [
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[0]]),
      validAttestMessage.sign(guardians.privateKeys[guardians.addresses[1]]),
    ]

    assert.equals(await depositContractMock.totalCalls(), 1)
    await depositSecurityModule.depositBufferedEther(
      block.number,
      block.hash,
      depositRoot,
      CURATED_MODULE_ID,
      keysOpIndex,
      '0x',
      signatures
    )

    // The first 32 ETH chunk was deposited to the deposit contract,
    // using public key and signature of the only validator of the second operator

    assert.equals(await depositContractMock.totalCalls(), 2)

    const regCall = await depositContractMock.calls.call(1)
    assert.equal(regCall.pubkey, nodeOperator2.validators[0].key)
    assert.equal(regCall.withdrawal_credentials, withdrawalCredentials)
    assert.equal(regCall.signature, nodeOperator2.validators[0].sig)
    assert.equals(regCall.value, ETH(32))

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, 0, 'remote ether2')

    // The pool ran out of validator keys, so the remaining 32 ETH were added to the
    // pool buffer

    // The contract's balance must be non-zero. When the contract is deployed,
    // it receives LIDO_INIT_BALANCE_ETH ETH in deployProtocol() function.

    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 1 + 32), 'buffered ether')
    assert.equals(await pool.getTotalPooledEther(), ETH(LIDO_INIT_BALANCE_ETH + 3 + 30 + 64), 'total pooled ether')

    // The amount of tokens corresponding to the deposited ETH value was minted to the users

    assert.equals(await token.balanceOf(user1), tokens(3), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), tokens(30), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), tokens(64), 'user3 tokens')

    assert.equals(await token.totalSupply(), tokens(LIDO_INIT_BALANCE_ETH + 3 + 30 + 64), 'token total supply')
  })

  it('collect 9 ETH execution layer rewards to the vault', async () => {
    await setBalance(elRewardsVault.address, ETH(9))
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(9), 'Execution layer rewards vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side (+0.35 ETH) and claims collected execution layer rewards (+9 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, ETH(LIDO_INIT_BALANCE_ETH + 97), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(LIDO_INIT_BALANCE_ETH + 3 + 30 + 64), 'total pooled ether')

    // Reporting balance increase (64 => 64.35)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(64.35),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)

    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })
    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    //
    // totalFee = 1000 (10%)
    // reward = 9350000000000000000
    // oldTotalShares = 98000000000000000000
    // newTotalPooledEther = 107350000000000000000
    // shares2mint = int(9350000000000000000 * 1000 * 98000000000000000000 / (107350000000000000000 * 10000 - 1000 * 9350000000000000000 ))
    // shares2mint ~= 861062820091152800

    const newTotalShares = await token.getTotalShares()

    assert.equals(newTotalShares, new BN('98861062820091152563'), 'total shares')

    const elRewards = 9

    // Total pooled Ether increased
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(LIDO_INIT_BALANCE_ETH + 3 + 30 + 64.35 + elRewards), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(64.35), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 33 + elRewards), 'buffered ether')

    // New tokens was minted to distribute fee
    assert.equals(await token.totalSupply(), tokens(98.35 + elRewards), 'token total supply')

    const reward = toBN(ETH(64.35 - 64 + elRewards))
    const mintedAmount = new BN(totalFeePoints).mul(reward).divn(TOTAL_BASIS_POINTS)

    // rewards = 9350000000000000000
    // user1 shares = 3
    // user2 shares = 30
    // user3 shares = 64

    // user1 balance = ETH(3) + 9350000000000000000 * 0.9 * 3/98 = ~3257602040816326530
    // user2 balance = ETH(30) + 9350000000000000000 * 0.9 * 30/98 = ~32576020408163265306
    // user3 balance = ETH(64) + 9350000000000000000 * 0.9 * 64/98 = ~69495510204081632653

    // Token user balances increased
    assert.equals(await token.balanceOf(user1), new BN('3257602040816326530'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('32576020408163265306'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('69495510204081632653'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance ~= mintedAmount * treasuryFeePoints / 10000
    // insuranceTokenBalance ~= mintedAmount * insuranceFeePoints / 10000

    // treasuryFeePoints = 500, insuranceFeePoints = 0
    assert.equals(await token.balanceOf(treasuryAddr), new BN('467500000000000000'), 'treasury tokens')

    // Module fee, rewards distribution between modules should be make by module
    assert.equals(await token.balanceOf(nodeOperatorsRegistry.address), new BN('467499999999999999'), 'module1 tokens')

    // Real minted amount should be a bit less than calculated caused by round errors on mint and transfer operations
    assert(
      mintedAmount
        .sub(
          new BN(0).add(await token.balanceOf(treasuryAddr)).add(await token.balanceOf(nodeOperatorsRegistry.address))
        )
        .lt(mintedAmount.divn(100))
    )
  })

  it('collect another 7 ETH execution layer rewards to the vault', async () => {
    const balanceBefore = +(await web3.eth.getBalance(elRewardsVault.address))
    await setBalance(elRewardsVault.address, ETH(7))

    assert.equals(
      await web3.eth.getBalance(elRewardsVault.address),
      +ETH(7) + balanceBefore,
      'Execution layer rewards vault balance'
    )
  })

  it('the oracle reports same balance on Ethereum2 side (+0 ETH) and claims collected execution layer rewards (+7 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, new BN('98861062820091152563'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(107.35), 'total pooled ether')

    // Reporting the same balance as it was before (64.35ETH => 64.35ETH)
    await advanceChainTime(ONE_DAY_WITH_MARGIN)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(64.35),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed

    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)

    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether increased

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(107.35 + 7), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly

    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(64.35), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 42 + 7), 'buffered ether')

    assert.equals(await token.totalSupply(), tokens(114.35), 'token total supply')

    // All of the balances should be increased with proportion of newTotalPooledEther/oldTotalPooledEther (which is >1)
    // cause shares per user and overall shares number are preserved

    // oldTotalPooledEther = 107.35
    // newTotalPooledEther = 107.35 + 7 = 114.35
    // newTotalPooledEther/oldTotalPooledEther = 1.065207266
    // sharePrice = 1156673787819739000

    // user1 balance = 3257602040816326530 * 1.065207266 = ~3470021363459216942
    // user1 balance = sharePrice * shares = 1156673787819739000 * 3 = ~3470021363459216942

    // user2 balance = 32576020408163265306 * 1.065207266 = ~34700213634592169424
    // user2 balance = sharePrice * shares = 1156673787819739000 * 30 = ~34700213634592169424

    // user3 balance = 69495510204081632653 * 1.065207266 = ~74027122420463294773
    // user3 balance = sharePrice * shares = 1156673787819739000 * 64 = ~74027122420463294773

    assert.equals(await token.balanceOf(user1), new BN('3470021363459216942'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('34700213634592169424'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('74027122420463294773'), 'user3 tokens')

    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice

    // oldTreasuryShares = 430531410045576260
    // mintedRewardShares = 0
    // sharePrice = 1156673787819739000
    // treasuryFeePoints = 500
    // treasuryTokenBalance = (43.0531410045576260 + (0 * 500) / 10000) * 1156673787819739000 = ~497984396832789939
    assert.equals(await token.balanceOf(treasuryAddr), new BN('497984396832789939'), 'treasury tokens')
    assert.equals(await token.balanceOf(nodeOperatorsRegistry.address), new BN('497984396832789938'), 'module1 tokens')

    // operators do not claim rewards from module
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'operator_1 tokens')
    assert.equals(await token.balanceOf(nodeOperator2.address), 0, 'operator_2 tokens')
  })

  it('collect another 5 ETH execution layer rewards to the vault', async () => {
    await setBalance(elRewardsVault.address, ETH(5))
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(5), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-2 ETH) and claims collected execution layer rewards (+5 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, new BN('98861062820091152563'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(114.35), 'total pooled ether')

    // Reporting balance decrease (64.35ETH => 62.35ETH)
    await advanceChainTime(ONE_DAY_WITH_MARGIN)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(62.35),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether increased by 5ETH - 2ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(114.35 + 3), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(62.35), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 49 + 5), 'buffered ether')

    assert.equals(await token.totalSupply(), tokens(114.35 + 3), 'token total supply')

    // All of the balances should be increased with proportion of newTotalPooledEther/oldTotalPooledEther (which is >1)
    // cause shares per user and overall shares number are preserved

    // oldTotalPooledEther = 114.35
    // newTotalPooledEther = 114.35 + 3 = 117.35
    // newTotalPooledEther/oldTotalPooledEther = 1,0262352427
    // sharePrice = 1187019405340151800

    // user1 balance = 3470021363459216942 * 1,0262352427 = ~3561058216020455690
    // user1 balance = sharePrice * shares = 1187019405340151800 * 3 = ~3561058216020455690

    // user2 balance = 34700213634592169424 * 1,0262352427 = ~35610582160204556904
    // user2 balance = sharePrice * shares = 1187019405340151800 * 30 = ~35610582160204556904

    // user3 balance = 74027122420463294773 * 1,0262352427 = ~75969241941769721395
    // user3 balance = sharePrice * shares = 1187019405340151800 * 64 = ~75969241941769721395

    assert.equals(await token.balanceOf(user1), new BN('3561058216020455690'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('35610582160204556904'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('75969241941769721395'), 'user3 tokens')

    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice

    // oldTreasuryShares = 430531410045576260
    // mintedRewardShares = 0
    // sharePrice = 1187019405340151800
    // treasuryFeePoints = 500
    // treasuryTokenBalance = (43.0531410045576260 + (0 * 500) / 10000) * 1187019405340151800 = ~511049138332557056

    assert.equals(await token.balanceOf(treasuryAddr), new BN('511049138332557056'), 'treasury tokens')
    assert.equals(await token.balanceOf(nodeOperatorsRegistry.address), new BN('511049138332557055'), 'module1 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await setBalance(elRewardsVault.address, ETH(3))
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-3 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint
    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, new BN('98861062820091152563'), 'total shares')

    // Old total pooled Ether
    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(117.35), 'total pooled ether')

    // Reporting balance decrease (62.35ETH => 59.35ETH)
    await advanceChainTime(ONE_DAY_WITH_MARGIN)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(59.35),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, oldTotalShares, 'total shares')

    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, oldTotalPooledEther, 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(59.35), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 54 + 3), 'buffered ether')

    assert.equals(await token.totalSupply(), tokens(117.35), 'token total supply')

    // oldTotalPooledEther = 117.35
    // newTotalPooledEther = 117.35
    // newTotalPooledEther/oldTotalPooledEther = 1
    // sharePrice = 1187019405340151800

    // All of the balances should be the same as before cause overall changes sums to zero
    assert.equals(await token.balanceOf(user1), new BN('3561058216020455690'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('35610582160204556904'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('75969241941769721395'), 'user3 tokens')

    assert.equals(await token.balanceOf(treasuryAddr), new BN('511049138332557056'), 'treasury tokens')
    assert.equals(await token.balanceOf(nodeOperatorsRegistry.address), new BN('511049138332557055'), 'module1 tokens')
  })

  it('collect another 2 ETH execution layer rewards to the vault', async () => {
    await setBalance(elRewardsVault.address, ETH(2))
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(2), 'Execution layer rewards vault balance')
  })

  it('the oracle reports loss on Ethereum2 side (-8 ETH) and claims collected execution layer rewards (+2 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, new BN('98861062820091152563'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(117.35), 'total pooled ether')

    // Reporting balance decrease (59.35ETH => 51.35ETH)
    await advanceChainTime(ONE_DAY_WITH_MARGIN)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(51.35),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares preserved because fee shares NOT minted
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, oldTotalShares, 'total shares')

    // Total pooled Ether decreased by 8ETH-2ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(111.35), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(51.35), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 57 + 2), 'buffered ether')

    assert.equals(await token.totalSupply(), tokens(111.35), 'token total supply')

    // oldTotalPooledEther = 117.35
    // newTotalPooledEther = 117.35 - 6 = 111.35
    // newTotalPooledEther/oldTotalPooledEther = 0,948870899
    // sharePrice = 1126328170299326100

    // user1 balance = 3561058216020455690 * 0,948870899 = ~3378984510897978194
    // user1 balance = sharePrice * shares = 1126328170299326100 * 3 = ~3378984510897978194

    // user2 balance = 35610582160204556904 * 0,948870899 = ~33789845108979781945
    // user2 balance = sharePrice * shares = 1126328170299326100 * 30 = ~33789845108979781945

    // user3 balance = 75969241941769721395 * 0,948870899 = ~72085002899156868150
    // user3 balance = sharePrice * shares = 1126328170299326100 * 64 = ~72085002899156868150

    // All of the balances should be decreased with proportion of newTotalPooledEther/oldTotalPooledEther (which is <1)
    // cause shares per user and overall shares number are preserved
    assert.equals(await token.balanceOf(user1), new BN('3378984510897978194'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('33789845108979781945'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('72085002899156868150'), 'user3 tokens')

    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice

    // oldTreasuryShares = 430531410045576260
    // mintedRewardShares = 0
    // sharePrice = 1126328170299326100
    // treasuryFeePoints = 500
    // treasuryTokenBalance = (43.0531410045576260 + (0 * 500) / 10000) * 1126328170299326100 = ~484919655333022823

    assert.equals(await token.balanceOf(treasuryAddr), new BN('484919655333022823'), 'treasury tokens')
    assert.equals(await token.balanceOf(nodeOperatorsRegistry.address), new BN('484919655333022821'), 'module1 tokens')
    assert.equals(await token.balanceOf(nodeOperator1.address), 0, 'operator_1 tokens')
    assert.equals(await token.balanceOf(nodeOperator2.address), 0, 'operator_2 tokens')
  })

  it('collect another 3 ETH execution layer rewards to the vault', async () => {
    await setBalance(elRewardsVault.address, ETH(3))
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(3), 'Execution layer vault balance')
  })

  it('the oracle reports balance increase on Ethereum2 side (+0.14 ETH) and claims collected execution layer rewards (+3 ETH)', async () => {
    // Total shares are equal to deposited eth before ratio change and fee mint

    const oldTotalShares = await token.getTotalShares()
    assert.equals(oldTotalShares, new BN('98861062820091152563'), 'total shares')

    // Old total pooled Ether

    const oldTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(oldTotalPooledEther, ETH(111.35), 'total pooled ether')

    // Reporting balance increase (51.35ETH => 51.49ETH)
    await advanceChainTime(ONE_DAY_WITH_MARGIN)

    const { refSlot } = await consensus.getCurrentFrame()

    const reportItems = getAccountingReportDataItems(
      makeAccountingReport({
        refSlot: +refSlot,
        numValidators: 2,
        clBalanceGwei: gwei(51.49),
        elRewardsVaultBalance: await web3.eth.getBalance(elRewardsVault.address),
      })
    )
    const reportHash = calcAccountingReportDataHash(reportItems)
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
    await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

    await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

    // Execution layer rewards just claimed

    assert.equals(await web3.eth.getBalance(elRewardsVault.address), ETH(0), 'Execution layer rewards vault balance')

    // Total shares increased because fee minted (fee shares added)
    // shares ~= oldTotalShares + reward * oldTotalShares / (newTotalPooledEther - reward)
    //
    // totalFee = 1000 (10%)
    // reward = 3140000000000000000
    // oldTotalShares = 98861062820091152563
    // newTotalPooledEther = 114490000000000000000
    // shares2mint = int(3140000000000000000 * 1000 * 98861062820091152563 / (114490000000000000000 * 10000 - 1000 * 3140000000000000000 ))
    // shares2mint ~= 271881776603740030
    // newTotalShares = oldTotalShares + shares2mint = 98861062820091152563 + 271881776603740030 ~= 99132944596694892595

    const newTotalShares = await token.getTotalShares()
    assert.equals(newTotalShares, new BN('99132944596694892595'), 'total shares')

    // Total pooled Ether increased by 0.14ETH+3ETH
    const newTotalPooledEther = await pool.getTotalPooledEther()
    assert.equals(newTotalPooledEther, ETH(111.49 + 3), 'total pooled ether')

    // Ether2 stat reported by the pool changed correspondingly
    const ether2Stat = await pool.getBeaconStat()
    assert.equals(ether2Stat.depositedValidators, 2, 'deposited ether2')
    assert.equals(ether2Stat.beaconBalance, ETH(51.49), 'remote ether2')

    // Buffered Ether amount changed on execution layer rewards
    assert.equals(await pool.getBufferedEther(), ETH(LIDO_INIT_BALANCE_ETH + 59 + 3), 'buffered ether')

    assert.equals(await token.totalSupply(), tokens(111.49 + 3), 'token total supply')

    // newTotalPooledEther/oldTotalPooledEther = 1.0281993714
    // sharePrice = 1154913742003555000

    // user1 balance = sharePrice * shares = 1154913742003555000 * 3 = ~3464741226010665095
    // user2 balance = sharePrice * shares = 1154913742003555000 * 30 = ~34647412260106650951
    // user3 balance = sharePrice * shares = 1154913742003555000 * 64 = ~73914479488227522028

    // Token user balances increased
    assert.equals(await token.balanceOf(user1), new BN('3464741226010665095'), 'user1 tokens')
    assert.equals(await token.balanceOf(user2), new BN('34647412260106650951'), 'user2 tokens')
    assert.equals(await token.balanceOf(user3), new BN('73914479488227522028'), 'user3 tokens')

    // Fee, in the form of minted tokens, was distributed between treasury, insurance fund
    // and node operators
    // treasuryTokenBalance = (oldTreasuryShares + mintedRewardShares * treasuryFeePoints / 10000) * sharePrice

    // oldTreasuryShares = 566472298347446300
    // mintedRewardShares = 0
    // sharePrice = 1154913742003555000
    // treasuryFeePoints = 500
    // treasuryTokenBalance = (56.6472298347446300 + (0 * 500) / 10000) * 1154913742003555000 = ~65422664182580344

    assert.equals((await token.balanceOf(treasuryAddr)).divn(10), new BN('65422664182580344'), 'treasury tokens')
    assert.equals(
      (await token.balanceOf(nodeOperatorsRegistry.address)).divn(10),
      new BN('65422664182580344'),
      'module1 tokens'
    )
  })

  it('collect execution layer rewards to elRewardsVault and withdraw it entirely by means of multiple oracle reports', async () => {
    const tokenRebaseLimit = toBN(10000000)

    await oracleReportSanityChecker.setOracleReportLimits(
      {
        ...ORACLE_REPORT_LIMITS_BOILERPLATE,
        maxPositiveTokenRebase: tokenRebaseLimit.toString(), // 1%
      },
      { from: voting, gasPrice: 1 }
    )

    const elRewards = ETH(5)
    await setBalance(elRewardsVault.address, elRewards)
    assert.equals(await web3.eth.getBalance(elRewardsVault.address), elRewards, 'Execution layer rewards vault balance')

    let frame = 7
    let lastBeaconBalance = toBN(ETH(51.49))

    let elRewardsVaultBalance = toBN(elRewards)
    let totalPooledEther = await pool.getTotalPooledEther()
    let totalShares = await pool.getTotalShares()
    let bufferedEther = await pool.getBufferedEther()
    let elRewardsWithdrawn = toBN(0)
    const beaconBalanceInc = toBN(ETH(0.001))

    // Do multiple oracle reports to withdraw all ETH from execution layer rewards vault
    while (elRewardsVaultBalance > 0) {
      await advanceChainTime(ONE_DAY_WITH_MARGIN)

      const currentELBalance = await web3.eth.getBalance(elRewardsVault.address)

      const { refSlot } = await consensus.getCurrentFrame()
      const reportItems = getAccountingReportDataItems(
        makeAccountingReport({
          refSlot,
          numValidators: 2,
          clBalanceGwei: ethToGwei(lastBeaconBalance.add(beaconBalanceInc)),
          elRewardsVaultBalance: currentELBalance,
        })
      )
      const reportHash = calcAccountingReportDataHash(reportItems)

      await consensus.submitReport(refSlot, reportHash, 1, { from: signers[2].address })
      await consensus.submitReport(refSlot, reportHash, 1, { from: signers[3].address })

      await oracleMock.submitReportData(reportItems, 1, { from: signers[4].address })

      const { elBalanceUpdate } = limitRebase(
        toBN(tokenRebaseLimit),
        totalPooledEther,
        totalShares,
        beaconBalanceInc,
        toBN(currentELBalance),
        toBN(0)
      )

      assert.equals(
        await web3.eth.getBalance(elRewardsVault.address),
        elRewardsVaultBalance.sub(toBN(elBalanceUpdate)),
        'Execution layer rewards vault balance'
      )

      assert.equals(
        await pool.getTotalPooledEther(),
        totalPooledEther.add(beaconBalanceInc).add(elBalanceUpdate),
        'total pooled ether'
      )

      assert.equals(await pool.getBufferedEther(), bufferedEther.add(elBalanceUpdate), 'buffered ether')

      elRewardsVaultBalance = toBN(await web3.eth.getBalance(elRewardsVault.address))
      totalPooledEther = await pool.getTotalPooledEther()
      totalShares = await pool.getTotalShares()
      bufferedEther = await pool.getBufferedEther()

      lastBeaconBalance = lastBeaconBalance.add(beaconBalanceInc)
      elRewardsWithdrawn = elRewardsWithdrawn.add(elBalanceUpdate)

      frame += 1
    }

    assert.equals(elRewardsWithdrawn, elRewards)
    assert.equals(elRewardsVaultBalance, toBN(0))
    assert.isTrue(frame > 10)
  })
})
