const { hash: namehash } = require('eth-ens-namehash')
const { encodeCallScript } = require('@aragon/contract-helpers-test/src/aragon-os')
const { BN } = require('bn.js')

const runOrWrapScript = require('../helpers/run-or-wrap-script')
const { log, logSplitter, logWideSplitter, yl, gr } = require('../helpers/log')
const { saveCallTxData } = require('../helpers/tx-data')
const { readNetworkState, assertRequiredNetworkState, persistNetworkState } = require('../helpers/persisted-network-state')
const { resolveEnsAddress } = require('../components/ens')

const { APP_NAMES } = require('./constants')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const DEPLOYER = process.env.DEPLOYER || ''
const REQUIRED_NET_STATE = [
  'lidoApmEnsName',
  'ensAddress',
  'daoAddress',
  `app:${APP_NAMES.ARAGON_VOTING}`,
  `app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`
]

async function createVoting({ web3, artifacts }) {
  const netId = await web3.eth.net.getId()

  logWideSplitter()
  log(`Network ID:`, yl(netId))

  const state = readNetworkState(network.name, netId)
  assertRequiredNetworkState(state, REQUIRED_NET_STATE)

  logSplitter()

  const votingAddress = state[`app:${APP_NAMES.ARAGON_VOTING}`].proxyAddress
  const tokenManagerAddress = state[`app:${APP_NAMES.ARAGON_TOKEN_MANAGER}`].proxyAddress
  const voting = await artifacts.require('Voting').at(votingAddress)
  const tokenManager = await artifacts.require('TokenManager').at(tokenManagerAddress)
  const kernel = await artifacts.require('Kernel').at(state.daoAddress)
  const aclAddress = await kernel.acl()
  const acl = await artifacts.require('ACL').at(aclAddress)

  const objectionPhaseTimeSec = 5
  const voteTimeSec = 60

  log(`Using ENS:`, yl(state.ensAddress))
  log(`TokenManager address:`, yl(tokenManagerAddress))
  log(`Voting address:`, yl(votingAddress))
  log(`Kernel:`, yl(kernel.address))
  log(`ACL:`, yl(acl.address))

  log.splitter()

  const voteRoleId = '0x068ca51c9d69625c7add396c98ca4f3b27d894c3b973051ad3ee53017d7094ea' // keccak256(UNSAFELY_MODIFY_VOTE_TIME_ROLE)


  // This script grants and revokes the role so checking it is absent at the beginning
  // assert.isFalse(await acl.hasPermission(votingAddress, votingAddress, voteRoleId))

  const createChangeVoteTimePermission = {
    to: acl.address,
    calldata: await acl.contract.methods
      .createPermission(
        votingAddress,
        votingAddress,
        voteRoleId,
        votingAddress
      )
      .encodeABI()
  }

  const grantChangeVoteTimePermission = {
    to: acl.address,
    calldata: await acl.contract.methods
      .grantPermission(
        votingAddress,
        votingAddress,
        voteRoleId
      )
      .encodeABI()
  }

  const revokeChangeVoteTimePermission = {
    to: acl.address,
    calldata: await acl.contract.methods
      .revokePermission(
        votingAddress,
        votingAddress,
        voteRoleId
      )
      .encodeABI()
  }

  const changeObjectionTime = {
    to: votingAddress,
    calldata: await voting.contract.methods.unsafelyChangeObjectionPhaseTime(objectionPhaseTimeSec).encodeABI()
  }

  const changeVoteTime = {
    to: votingAddress,
    calldata: await voting.contract.methods.unsafelyChangeVoteTime(voteTimeSec).encodeABI()
  }

  const encodedUpgradeCallData = encodeCallScript([
    createChangeVoteTimePermission,
    grantChangeVoteTimePermission,
    changeObjectionTime,
    changeVoteTime,
    revokeChangeVoteTimePermission,
  ])

  log(`encodedUpgradeCallData:`, yl(encodedUpgradeCallData))
  const votingCallData = encodeCallScript([
    {
      to: votingAddress,
      calldata: await voting.contract.methods.forward(encodedUpgradeCallData).encodeABI()
    }
  ])

  const txName = `tx-32-change-voting-time.json`
  const votingDesc =
`1) Grant permission UNSAFELY_MODIFY_VOTE_TIME_ROLE to Voting
2) Set objection phase time to ${objectionPhaseTimeSec} seconds
3) Set total vote time to ${voteTimeSec} seconds
4) Revoke permission UNSAFELY_MODIFY_VOTE_TIME_ROLE from Voting`

  await saveCallTxData(votingDesc, tokenManager, 'forward', txName, {
    arguments: [votingCallData],
    from: DEPLOYER || state.deployer
  })

  log.splitter()
  log(gr(`Before continuing the deployment, please send all transactions listed above.`))
  log(gr(`You must complete it positively and execute before continuing with the deployment!`))
  log.splitter()
}


module.exports = runOrWrapScript(createVoting, module)
