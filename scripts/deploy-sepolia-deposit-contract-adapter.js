const runOrWrapScript = require('./helpers/run-or-wrap-script')

const DEPLOYER = process.env.DEPLOYER || ''

async function deployNewContracts({ web3, artifacts }) {
  // const netId = await web3.eth.net.getId()
  // logWideSplitter()
  // log(`Network ID:`, yl(netId))
  // let state = readNetworkState(network.name, netId)
  // assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  if (!DEPLOYER) {
    throw new Error('Deployer is not specified')
  }

  const sepoliaDepositContract = "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"
  // const constructorArgs = [sepoliaDepositContract]
  const constructorArgs = []
  const Contract = await ethers.getContractFactory("SepoliaDepositAdapter")
  const txParams = {
    type: 2,
    maxPriorityFeePerGas: ethers.utils.parseUnits(String(2), "gwei"),
    maxFeePerGas: ethers.utils.parseUnits(String(200), "gwei"),
    // from: DEPLOYER,
  }
  const contract = await Contract.deploy(...constructorArgs, txParams)
  await contract.deployed()

  console.log(contract.address)

}

module.exports = runOrWrapScript(deployNewContracts, module)
