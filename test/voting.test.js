import { prepareContext } from "./helpers";

require('dotenv').config()
import test from 'ava'

import { abi as votingAbi } from '@aragon/apps-voting/abi/Voting.json'
import { abi as tokenManagerAbi } from '@aragon/apps-token-manager/abi/TokenManager.json'
import { abi as financeAbi } from '@aragon/apps-finance/abi/Finance.json'
import { abi as vaultAbi } from '@aragon/apps-finance/abi/Vault.json'

//inject events ABI for results decoding in forwarding calls
const tokenManagerAbiExt = tokenManagerAbi.concat(votingAbi.filter(i => i.type === 'event'))
const financeAbiExt = financeAbi.concat(vaultAbi.filter(i => i.type === 'event'))
const votingAbiExt = votingAbi.concat(financeAbiExt.filter(i => i.type === 'event'))
const voteSettings = JSON.parse(process.env.VOTING_SETTINGS)

import { encodeCallScript } from '@aragon/contract-helpers-test/src/aragon-os'
import {
  getAllApps,
  ZERO_ADDRESS
} from '@aragon/toolkit'

import {
  ether,
  constants,    // Common constants, like the zero address and largest integers
  expectEvent,  // Assertions for emitted events
  expectRevert, // Assertions for transactions that should fail
} from '@openzeppelin/test-helpers'


test.before('Connecting Web3', async (t) => {
  t.context = await prepareContext()
})

test('Voting ',
  async t => {
    const { web3, accounts, apps } = t.context
    // console.log(`Apps: ${apps.map(({ name }) => name).join(', ')}`)
    const { votingApp, financeApp, vaultApp, tokenManagerApp } = apps
    if (!votingApp) throw Error(`Voting app not found`)
    const votingAddress = votingApp.proxyAddress
    // console.log(`Retrieved voting app: ${votingAddress}`)

    if (!financeApp) throw Error(`Finance app not found`)
    const financeAddress = financeApp.proxyAddress
    // console.log(`Retrieved finance app: ${financeAddress}`)

    if (!vaultApp) throw Error(`Agent app not found`)
    const vaultAddress = vaultApp.proxyAddress
    // console.log(`Retrieved vault app: ${vaultAddress}`)

    if (!tokenManagerApp) throw Error(`TokenManager app not found`)
    const tokenManagerAddress = tokenManagerApp.proxyAddress
    // console.log(`Retrieved TokenManager app: ${tokenManagerAddress}`)

    // apps instances
    const Voting = new web3.eth.Contract(votingAbiExt, votingAddress)
    const Finance = new web3.eth.Contract(financeAbiExt, financeAddress)
    const TokenManager = new web3.eth.Contract(tokenManagerAbiExt, tokenManagerAddress)


    // Voting setting
    const curVotingSettings = await Promise.all([
      Voting.methods.supportRequiredPct().call(),
      Voting.methods.minAcceptQuorumPct().call(),
      Voting.methods.voteTime().call()
    ])

    // check the whole array
    // t.deepEqual(curVotingSettings, voteSettings, 'Voting settings')
    // or one by one
    const [supportRequiredPct, minAcceptQuorumPct, voteTime] = curVotingSettings
    t.is(supportRequiredPct, voteSettings[0], 'supportRequiredPct')
    t.is(minAcceptQuorumPct, voteSettings[1], 'minAcceptQuorumPct')
    t.is(voteTime, voteSettings[2], 'voteTime')

    const [holder1, holder2, holder3, holder4, holder5, sender, recipient] = accounts;
    const holders = [holder1, holder2, holder3, holder4, holder5]
    let val, ref, receipt


    // New Vote
    console.log('put some ETH to Finance app')

    // function deposit(address _token, uint256 _amount, string _reference)
    // * @param _token Address of deposited token
    // * @param _amount Amount of tokens sent
    // * @param _reference Reason for payment
    val = ether("1.23")
    ref = "test transfer"
    receipt = await Finance.methods.deposit(
      ZERO_ADDRESS, // === ETH
      val,
      ref
    ).send({ from: sender, value: val, gas: '1000000', })

    //also we can check event on Vault contract
    // awaiting events:
    // event NewTransaction(uint256 indexed transactionId, bool incoming, address indexed entity, uint256 amount, string reference);
    expectEvent(receipt, 'NewTransaction', {
      entity: sender,
      amount: val,
      reference: ref
    });
    expectEvent(receipt, 'VaultDeposit', {
      token: ZERO_ADDRESS,
      sender: financeAddress,
      amount: val
    });

    // Withdraw
    console.log('create Voting for withdraw')
    // we can't call withdraw from Finance app directly due to permissions
    // so we forward calls:
    //   1) Tokens App (as holder) -> Voting app (create a new vote)
    //   2) Voting App (when the vote executed) -> Finance app (make a transfer)

    val = ether("1.11")
    ref = "test withdraw"

    // encode call to finance app for withdraw
    let callData1 = encodeCallScript([
      {
        to: financeAddress,
        // function newImmediatePayment(address _token, address _receiver, uint256 _amount, string _reference)
        // * @param _token Address of token for payment
        // * @param _receiver Address that will receive payment
        // * @param _amount Tokens that are paid every time the payment is due
        // * @param _reference String detailing payment reason
        calldata: await Finance.methods.newImmediatePayment(
          ZERO_ADDRESS, // === ETH
          recipient,
          val,
          ref).encodeABI(),
      }
    ])
    // encode forwarding call from Voting app to Finance app
    // (new Vote will be created under hood)
    let callData2 = encodeCallScript([
      {
        to: votingAddress,
        calldata: await Voting.methods.forward(callData1).encodeABI(),
      }
    ])

    // function newVote(bytes _executionScript, string _metadata) external auth(CREATE_VOTES_ROLE) returns (uint256 voteId) {

    // finally calling Tokens app for forward call
    receipt = await TokenManager.methods.forward(callData2).send({ from: holder5, gas: '1000000' })

    //event StartVote(uint256 indexed voteId, address indexed creator, string metadata);
    expectEvent(receipt, 'StartVote', {
      // voteId: 1,
      creator: tokenManagerAddress,
      metadata: ''
    });
    // save vote Id
    let { voteId } = receipt.events['StartVote'].returnValues

    console.log('make some supports votes')
    //function vote(uint256 _voteId, bool _supports, bool _executesIfDecided) external voteExists(_voteId) {
    // * @param _voteId Id for vote
    // * @param _supports Whether voter supports the vote
    // * @param _executesIfDecided Whether the vote should execute its action if it becomes decided

    // we have 5 holder, so 3 holders is enough to pass voting
    // last voted holder will execute vote
    for(let i = 0; i < 3; i++) {
      receipt = await Voting.methods.vote(voteId, true, true).send({ from: holders[i], gas: '1000000' })
      // event CastVote(uint256 indexed voteId, address indexed voter, bool supports, uint256 stake);
      expectEvent(receipt, 'CastVote', {
        voteId,
        voter: holders[i],
        supports: true
      });
    }

    // alternate we can wait to vote period ended
    // console.log('waiting to vote period ending')
    // await sleep(10000)
    // console.log('executing vote')
    // receipt = await Voting.methods.executeVote(voteId).send({ from: recipient, gas: '1000000' })
    // console.log(receipt.events)

    // event ExecuteVote(uint256 indexed voteId);
    expectEvent(receipt, 'ExecuteVote', {
      voteId
    })
    expectEvent(receipt, 'NewTransaction', {
      entity: recipient,
      amount: val,
      reference: ref
    })
    expectEvent(receipt, 'VaultTransfer', {
      token: ZERO_ADDRESS,
      to: recipient,
      amount: val
    })

    t.pass()
  }
)