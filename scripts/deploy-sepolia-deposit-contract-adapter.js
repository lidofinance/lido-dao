const runOrWrapScript = require('./helpers/run-or-wrap-script')
const { deployBehindOssifiableProxy } = require('./helpers/deploy')

const DEPLOYER = process.env.DEPLOYER || ''

async function deployNewContracts({ web3, artifacts }) {
  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  const sepoliaDepositContract = "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"
  const depositAdapterProxyOwner = "0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5"
  const constructorArgs = [sepoliaDepositContract]

  const contract = await deployBehindOssifiableProxy(null, "SepoliaDepositAdapter", depositAdapterProxyOwner, DEPLOYER,
    constructorArgs, null)

  console.log(contract)

}

module.exports = runOrWrapScript(deployNewContracts, module)
