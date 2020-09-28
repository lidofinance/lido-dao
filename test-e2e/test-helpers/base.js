import Web3 from 'web3'

export const getLocalWeb3 = async () => {
  const web3 = new Web3(new Web3.providers.WebsocketProvider(`ws://localhost:8545`))
  const connected = await web3.eth.net.isListening()
  if (!connected) throw new Error('Web3 connection failed')
  return web3
}

export function getApmOptions() {
  const options = {}

  options.registryAddress = '0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1'

  options.ipfs = {
    rpc: {
      protocol: 'http',
      host: 'localhost',
      port: 5001,
      default: true
    },
    gateway: 'http://localhost:8080/ipfs'
  }

  return options
}
