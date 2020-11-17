const { getContract } = require('./abi')
const { ZERO_ADDR } = require('./utils')

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

module.exports = {
  Lido,
  StETH,
  getLido,
  getStETH,
  submitEther
}
