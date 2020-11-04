import Web3, { providers } from 'web3'

export const getLocalWeb3 = async () => {
  const web3 = new Web3(new providers.WebsocketProvider(`ws://localhost:8545`))

  web3.extend({
    property: 'ganache',
    methods: [
      {
        name: 'mine',
        call: 'evm_mine',
        params: 1,
        inputFormatter: [null]
        // outputFormatter: web3.utils.hexToNumberString
      }
    ]
  })

  const connected = await web3.eth.net.isListening()
  if (!connected) throw new Error('Web3 connection failed')
  return web3
}

export const getAccounts = async (web3) =>
  new Promise((resolve, reject) => {
    web3.eth.getAccounts((err, res) => (err ? reject(err) : resolve(res)))
  })

export const sendTransaction = async (web3, from, to, value, gas = '3000000') => {
  return web3.eth.sendTransaction({ from, to, value, gas })
}
export const getBalance = async (web3, address) => {
  return web3.eth.getBalance(address)
}
