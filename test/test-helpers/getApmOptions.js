export function getApmRegistryName() {
  return 'aragonpm.eth'
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
