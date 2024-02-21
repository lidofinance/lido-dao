const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { deployBehindOssifiableProxy } = require('./helpers/deploy')

const DEPLOYER = process.env.DEPLOYER || ''

async function updateAdapterImplementation(proxyOwner) {
  const sepoliaDepositAdapter = "<new-deposit-adapter-address>"
  const proxyAddress = "0x80b5DC88C98E528bF9cb4B7F0f076aC41da24651"

  const OssifiableProxy = await artifacts.require('OssifiableProxy')
  const proxy = await OssifiableProxy.at(proxyAddress)

  await proxy.proxy__upgradeTo(sepoliaDepositAdapter, { from: proxyOwner })
}

async function deployAdaperBehindProxy(depositAdapterProxyOwner) {
  const sepoliaDepositContract = "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"
  const constructorArgs = [sepoliaDepositContract]

  const contract = await deployBehindOssifiableProxy(null, "SepoliaDepositAdapter", depositAdapterProxyOwner, DEPLOYER,
    constructorArgs, null)

  console.log('new-deposit-adapter-address', contract)
}

// RPC_URL=<rpc> yarn hardhat --network sepolia verify --no-compile --contract "contracts/0.8.9/SepoliaDepositAdapter.sol:SepoliaDepositAdapter" --constructor-args contract-args.js <new-address>
// contract-args.js example:
// module.exports = [
//  '0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D'
// ]

async function deployNewContracts({ web3, artifacts }) {
  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  const depositAdapterProxyOwner = "0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5"

  // await deployAdaperBehindProxy(depositAdapterProxyOwner)
  await updateAdapterImplementation(depositAdapterProxyOwner)
}

module.exports = runOrWrapScript(deployNewContracts, module)
