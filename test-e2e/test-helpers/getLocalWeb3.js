import Web3 from 'web3'

export const getLocalWeb3 = async () => {
  const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://localhost:8545`))
  const connected = await web3.eth.net.isListening()
  if (!connected) throw new Error('Web3 connection failed')
  return web3
}
