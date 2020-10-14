const Web3 = require('web3')

const getLocalWeb3 = async () => {
  const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://localhost:8545`))
  const connected = await web3.eth.net.isListening()
  if (!connected) throw new Error('Web3 connection failed')
  return web3
}
exports.getLocalWeb3 = getLocalWeb3

const getAccounts = async (web3) =>
  new Promise((resolve, reject) => {
    web3.eth.getAccounts((err, res) => (err ? reject(err) : resolve(res)))
  })
exports.getAccounts = getAccounts

const sendTransaction = async (web3, receipt, sender, value) => {
  return web3.eth.sendTransaction({ to: receipt, from: sender, value: value, gas: '3000000' })
}
exports.sendTransaction = sendTransaction
