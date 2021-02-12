const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const { getContract } = require('./abi')
const { ZERO_ADDR } = require('./utils')
const { createVote } = require('./dao')

const Lido = getContract('Lido')
const StETH = getContract('StETH')

async function getLido(web3, address) {
  Lido.setProvider(web3.currentProvider)
  return await Lido.at(address)
}

async function getStETH(web3, address) {
  StETH.setProvider(web3.currentProvider)
  return await StETH.at(address)
}

async function submitEther(lido, amount, txOpts = {}, referral = null, doDeposit = false) {
  const submitTxOpts = { ...txOpts, value: amount }
  const submitResult = await lido.submit(referral || ZERO_ADDR, submitTxOpts)
  if (!doDeposit) {
    return submitResult
  }
  const depositResult = await lido.depositBufferedEther({
    gasPrice: txOpts.gasPrice,
    from: txOpts.from
  })
  return { submitResult, depositResult }
}

async function setWithdrawalCredentials(lido, voting, tokenManager, credentials, txOpts = {}) {
  const evmScript = encodeCallScript([
    {
      to: lido.address,
      calldata: await lido.contract.methods.setWithdrawalCredentials(credentials).encodeABI()
    }
  ])
  const voteDesc = `Set withdrawal credentials to ${credentials}`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

async function setFeeDistribution(
  lido,
  voting,
  tokenManager,
  treasuryFeeBasisPoints,
  insuranceFeeBasisPoints,
  operatorsFeeBasisPoints,
  txOpts = {}
) {
  if (treasuryFeeBasisPoints + insuranceFeeBasisPoints + operatorsFeeBasisPoints !== 10000) {
    throw new Error(`the sum of all fees must equal 10000`)
  }
  const evmScript = encodeCallScript([
    {
      to: lido.address,
      calldata: await lido.contract.methods
        .setFeeDistribution(treasuryFeeBasisPoints, insuranceFeeBasisPoints, operatorsFeeBasisPoints)
        .encodeABI()
    }
  ])
  const voteDesc =
    `Set fee distribution to: (treasury ${treasuryFeeBasisPoints}, ` +
    `insurance ${insuranceFeeBasisPoints}, operators ${operatorsFeeBasisPoints})`
  return await createVote(voting, tokenManager, voteDesc, evmScript, txOpts)
}

module.exports = {
  Lido,
  StETH,
  getLido,
  getStETH,
  submitEther,
  setWithdrawalCredentials,
  setFeeDistribution
}
