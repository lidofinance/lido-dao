const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  'depositorAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function upgradeAppImpl({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE.concat(['app:lido', 'app:node-operators-registry']))

  logSplitter()

  const ens = await artifacts.require('ENS').at(state.ensAddress)
  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const nosRegistryAddress = state[`app:${APP_NAMES.NODE_OPERATORS_REGISTRY}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const nosRegistry = await artifacts.require('NodeOperatorsRegistry').at(nosRegistryAddress)
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)
  const depositorAddress = state.depositorAddress

  log(`Using ENS:`, yl(state.ensAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Voting address:`, yl(votingAddress))
  log(`Kernel`, yl(kernel.address))
  log(`ACL`, yl(acl.address))
  log(`Using Depositor`, yl(depositorAddress))

  log.splitter()

  const lidoUpgradeCallData = await buildUpgradeTransaction('lido', state, ens, kernel)
  const NOSUpgradeCallData = await buildUpgradeTransaction('node-operators-registry', state, ens, kernel)
  const grantRoleCallData = {
    to: aclAddress,
    calldata: await acl.contract.methods
      .createPermission(
        depositorAddress,
        state[`app:lido`].proxyAddress,
        '0x2561bf26f818282a3be40719542054d2173eb0d38539e8a8d3cff22f29fd2384', // keccak256(DEPOSIT_ROLE)
        votingAddress
      )
      .encodeABI()
  }

  const nosIncreaseLimitsCallData = []
  const nosIncreaseLimitsDesc = []
  const numberOfNOs = (await nosRegistry.getNodeOperatorsCount()).toNumber()
  for (var i = 0; i < numberOfNOs; i++) {
    const nodeOperator = await nosRegistry.getNodeOperator(i, true)
    const totalSigningKeys = nodeOperator.totalSigningKeys.toNumber()
    const stakingLimit = nodeOperator.stakingLimit.toNumber()

    if (nodeOperator.active && stakingLimit < totalSigningKeys) {
      nosIncreaseLimitsCallData.push({
        to: nosRegistryAddress,
        calldata: await nosRegistry.contract.methods.setNodeOperatorStakingLimit(i, totalSigningKeys).encodeABI()
      })
      nosIncreaseLimitsDesc.push(`Set staking limit of operator ${i} to ${totalSigningKeys}`)
    }
  } 

  const encodedUpgradeCallData = encodeCallScript([
    ...lidoUpgradeCallData,
    ...NOSUpgradeCallData,
    grantRoleCallData,
    ...nosIncreaseLimitsCallData
  ])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-20-mitigating-deposit-front-running.json`
  const votingDesc = `1) Publishing new implementation in lido app APM repo
2) Updating implementation of lido app with new one
3) Publishing new implementation in node operators registry app APM repo
4) Updating implementation of node operators registry app with new one
5) Granting new permission DEPOSIT_ROLE for ${depositorAddress}
${nosIncreaseLimitsDesc.map((desc, index) => `${index + 6}) ${desc}`).join('\n')}
  `

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.multisigAddress
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}

async function buildUpgradeTransaction(appName, state, ens, kernel) {
  const appId = namehash(`${appName}.${state.lidoApmEnsName}`)
  const repoAddress = await resolveEnsAddress(artifacts, ens, appId)
  const newContractAddress = state[`app:${appName}`].baseAddress
  const newContentURI = state[`app:${appName}`].contentURI
  const repo = await artifacts.require('Repo').at(repoAddress)
  const APP_BASES_NAMESPACE = await kernel.APP_BASES_NAMESPACE()

  const { semanticVersion: currentVersion, contractAddress: currentContractAddress, contentURI: currentContentURI } = await repo.getLatest()

  const versionFrom = currentVersion.map((n) => n.toNumber())
  currentVersion[0] = currentVersion[0].addn(1)
  const versionTo = currentVersion.map((n) => n.toNumber())

  log.splitter()

  log(`Upgrading app:`, yl(appName))
  log(`App ID:`, yl(appId))
  log(`Contract implementation:`, yl(currentContractAddress), `->`, yl(newContractAddress))
  log(`Content URI:`, yl(currentContentURI), `->`, yl(newContentURI))
  log(`Bump version:`, yl(versionFrom.join('.')), `->`, yl(versionTo.join('.')))
  log(`Repo:`, yl(repoAddress))
  log(`APP_BASES_NAMESPACE`, yl(APP_BASES_NAMESPACE))

  log.splitter()
  const upgradeCallData = [
    {
      // repo.newVersion(versionTo, contractAddress, contentURI)
      to: repoAddress,
      calldata: await repo.contract.methods.newVersion(versionTo, newContractAddress, newContentURI).encodeABI()
    },

    {
      // kernel.setApp(APP_BASES_NAMESPACE, appId, oracle)
      to: state.daoAddress,
      calldata: await kernel.contract.methods.setApp(APP_BASES_NAMESPACE, appId, newContractAddress).encodeABI()
    }
  ]

  return upgradeCallData
}

module.exports = runOrWrapScript(upgradeAppImpl, module)
