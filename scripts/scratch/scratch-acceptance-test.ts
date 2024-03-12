import { assert } from "chai";
import { ContractRunner } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  AccountingOracle,
  AccountingOracle__factory,
  Agent,
  Agent__factory,
  DepositSecurityModule,
  HashConsensus,
  HashConsensus__factory,
  Lido,
  Lido__factory,
  LidoExecutionLayerRewardsVault,
  LidoExecutionLayerRewardsVault__factory,
  MiniMeToken,
  MiniMeToken__factory,
  NodeOperatorsRegistry,
  NodeOperatorsRegistry__factory,
  StakingRouter,
  StakingRouter__factory,
  Voting,
  Voting__factory,
  WithdrawalQueue,
  WithdrawalQueue__factory,
} from "typechain-types";

import { ContractFactoryHelper } from "lib/contract";
import { findEvents } from "lib/event";
import { streccak } from "lib/keccak";
import { log } from "lib/log";
import { reportOracle } from "lib/oracle";
import { DeploymentState, getAddress, readNetworkState, Sk } from "lib/state-file";
import { advanceChainTime } from "lib/time";
import { ether } from "lib/units";

const UNLIMITED_STAKING_LIMIT = 1000000000;
const CURATED_MODULE_ID = 1;
const DEPOSIT_CALLDATA = "0x00";
const MAX_DEPOSITS = 150;
const ADDRESS_1 = "0x0000000000000000000000000000000000000001";
const ADDRESS_2 = "0x0000000000000000000000000000000000000002";

const MANAGE_MEMBERS_AND_QUORUM_ROLE = streccak("MANAGE_MEMBERS_AND_QUORUM_ROLE");

if (!process.env.HARDHAT_FORKING_URL) {
  log.error("Env variable HARDHAT_FORKING_URL must be set to run fork acceptance tests");
  process.exit(1);
}
if (!process.env.NETWORK_STATE_FILE) {
  log.error("Env variable NETWORK_STATE_FILE must be set to run fork acceptance tests");
  process.exit(1);
}
const NETWORK_STATE_FILE = process.env.NETWORK_STATE_FILE;

async function main() {
  log.scriptStart(__filename);
  const deployerSigner = await ethers.provider.getSigner();
  const state = readNetworkState({ networkStateFile: NETWORK_STATE_FILE });

  const [user1, user2, oracleMember1, oracleMember2] = await ethers.getSigners();
  const protocol = await loadDeployedProtocol(state, deployerSigner);

  await checkLDOCanBeTransferred(protocol.ldo, state);

  await prepareProtocolForSubmitDepositReportWithdrawalFlow(
    protocol,
    await oracleMember1.getAddress(),
    await oracleMember2.getAddress(),
  );
  await checkSubmitDepositReportWithdrawal(protocol, state, user1, user2);
  log.scriptFinish(__filename);
}

type Extended<T> = T & { address: string };

interface Protocol {
  stakingRouter: Extended<StakingRouter>;
  lido: Extended<Lido>;
  voting: Extended<Voting>;
  agent: Extended<Agent>;
  nodeOperatorsRegistry: Extended<NodeOperatorsRegistry>;
  depositSecurityModule?: Extended<DepositSecurityModule>;
  depositSecurityModuleAddress: string | null;
  accountingOracle: Extended<AccountingOracle>;
  hashConsensusForAO: Extended<HashConsensus>;
  elRewardsVault: Extended<LidoExecutionLayerRewardsVault>;
  withdrawalQueue: Extended<WithdrawalQueue>;
  ldo: Extended<MiniMeToken>;
}

async function loadDeployedProtocol(state: DeploymentState, signer: unknown) {
  const loadContract = <TT, T>(factory: T, stateKey: Sk) => {
    const address = getAddress(stateKey, state);
    if (address === null) {
      throw new Error(`Cannot get address from state for key "${stateKey}"`);
    }
    const result = (factory as ContractFactoryHelper).connect(address, signer as ContractRunner) as Extended<TT>;
    result.address = address;
    return result;
  };

  return {
    stakingRouter: loadContract<StakingRouter, typeof StakingRouter__factory>(StakingRouter__factory, Sk.stakingRouter),
    lido: loadContract<Lido, typeof Lido__factory>(Lido__factory, Sk.appLido),
    voting: loadContract<Voting, typeof Voting__factory>(Voting__factory, Sk.appVoting),
    agent: loadContract<Agent, typeof Agent__factory>(Agent__factory, Sk.appAgent),
    nodeOperatorsRegistry: loadContract<NodeOperatorsRegistry, typeof NodeOperatorsRegistry__factory>(
      NodeOperatorsRegistry__factory,
      Sk.appNodeOperatorsRegistry,
    ),
    depositSecurityModuleAddress: getAddress(Sk.depositSecurityModule, state),
    accountingOracle: loadContract<AccountingOracle, typeof AccountingOracle__factory>(
      AccountingOracle__factory,
      Sk.accountingOracle,
    ),
    hashConsensusForAO: loadContract<HashConsensus, typeof HashConsensus__factory>(
      HashConsensus__factory,
      Sk.hashConsensusForAccountingOracle,
    ),
    elRewardsVault: loadContract<LidoExecutionLayerRewardsVault, typeof LidoExecutionLayerRewardsVault__factory>(
      LidoExecutionLayerRewardsVault__factory,
      Sk.executionLayerRewardsVault,
    ),
    withdrawalQueue: loadContract<WithdrawalQueue, typeof WithdrawalQueue__factory>(
      WithdrawalQueue__factory,
      Sk.withdrawalQueueERC721,
    ),
    ldo: loadContract<MiniMeToken, typeof MiniMeToken__factory>(MiniMeToken__factory, Sk.ldo),
  };
}

async function checkLDOCanBeTransferred(ldo: Extended<MiniMeToken>, state: DeploymentState) {
  const ldoHolder = Object.keys(state.vestingParams.holders)[0];
  const ldoHolderSigner = await ethers.provider.getSigner(ldoHolder);
  await ethers.provider.send("hardhat_impersonateAccount", [ldoHolder]);
  await ldo.connect(ldoHolderSigner).transfer(ADDRESS_1, ether("1"));
  assert.equal(await ldo.balanceOf(ADDRESS_1), ether("1"));
  log.success("Transferred LDO");
}

async function prepareProtocolForSubmitDepositReportWithdrawalFlow(
  protocol: Protocol,
  oracleMember1: string,
  oracleMember2: string,
) {
  const {
    lido,
    voting,
    agent,
    nodeOperatorsRegistry,
    depositSecurityModuleAddress,
    hashConsensusForAO,
    withdrawalQueue,
  } = protocol;

  await ethers.provider.send("hardhat_impersonateAccount", [voting.address]);
  await ethers.provider.send("hardhat_impersonateAccount", [depositSecurityModuleAddress]);
  await ethers.provider.send("hardhat_impersonateAccount", [agent.address]);
  const votingSigner = await ethers.provider.getSigner(voting.address);
  const agentSigner = await ethers.provider.getSigner(agent.address);

  const RESUME_ROLE = await withdrawalQueue.RESUME_ROLE();

  await lido.connect(votingSigner).resume();

  await withdrawalQueue.connect(agentSigner).grantRole(RESUME_ROLE, agent.address);
  await withdrawalQueue.connect(agentSigner).resume();
  await withdrawalQueue.connect(agentSigner).renounceRole(RESUME_ROLE, agent.address);

  await nodeOperatorsRegistry.connect(agentSigner).addNodeOperator("1", ADDRESS_1);
  await nodeOperatorsRegistry.connect(agentSigner).addNodeOperator("2", ADDRESS_2);

  const pad = ethers.zeroPadValue;
  await nodeOperatorsRegistry.connect(votingSigner).addSigningKeys(0, 1, pad("0x010203", 48), pad("0x01", 96));
  await nodeOperatorsRegistry
    .connect(votingSigner)
    .addSigningKeys(
      0,
      3,
      ethers.concat([pad("0x010204", 48), pad("0x010205", 48), pad("0x010206", 48)]),
      ethers.concat([pad("0x01", 96), pad("0x01", 96), pad("0x01", 96)]),
    );

  await nodeOperatorsRegistry.connect(votingSigner).setNodeOperatorStakingLimit(0, UNLIMITED_STAKING_LIMIT);
  await nodeOperatorsRegistry.connect(votingSigner).setNodeOperatorStakingLimit(1, UNLIMITED_STAKING_LIMIT);

  const quorum = 2;
  await hashConsensusForAO.connect(agentSigner).grantRole(MANAGE_MEMBERS_AND_QUORUM_ROLE, agent.address);
  await hashConsensusForAO.connect(agentSigner).addMember(oracleMember1, quorum);
  await hashConsensusForAO.connect(agentSigner).addMember(oracleMember2, quorum);
  await hashConsensusForAO.connect(agentSigner).renounceRole(MANAGE_MEMBERS_AND_QUORUM_ROLE, agent.address);

  log.success("Protocol prepared for submit-deposit-report-withdraw flow");
}

async function checkSubmitDepositReportWithdrawal(
  protocol: Protocol,
  state: DeploymentState,
  user1: HardhatEthersSigner,
  user2: HardhatEthersSigner,
) {
  const {
    lido,
    agent,
    depositSecurityModuleAddress,
    accountingOracle,
    hashConsensusForAO,
    elRewardsVault,
    withdrawalQueue,
  } = protocol;

  const initialLidoBalance = await ethers.provider.getBalance(lido.address);
  const chainSpec = state.chainSpec;
  const genesisTime = BigInt(chainSpec.genesisTime);
  const slotsPerEpoch = BigInt(chainSpec.slotsPerEpoch);
  const secondsPerSlot = BigInt(chainSpec.secondsPerSlot);
  const depositSecurityModuleSigner = await ethers.provider.getSigner(depositSecurityModuleAddress as string);
  const agentSigner = await ethers.provider.getSigner(agent.address);

  await user1.sendTransaction({ to: lido.address, value: ether("34") });
  await user2.sendTransaction({ to: elRewardsVault.address, value: ether("1") });
  log.success("Users submitted ether");

  assert.equal(await lido.balanceOf(user1.address), ether("34"));
  assert.equal(await lido.getTotalPooledEther(), initialLidoBalance + BigInt(ether("34")));
  assert.equal(await lido.getBufferedEther(), initialLidoBalance + BigInt(ether("34")));

  await lido.connect(depositSecurityModuleSigner).deposit(MAX_DEPOSITS, CURATED_MODULE_ID, DEPOSIT_CALLDATA);
  log.success("Ether deposited");

  assert.equal((await lido.getBeaconStat()).depositedValidators, 1n);

  const latestBlock = await ethers.provider.getBlock("latest");
  if (latestBlock === null) {
    throw new Error(`Failed with ethers.provider.getBlock("latest")`);
  }
  const latestBlockTimestamp = BigInt(latestBlock.timestamp);
  const initialEpoch = (latestBlockTimestamp - genesisTime) / (slotsPerEpoch * secondsPerSlot);

  await hashConsensusForAO.connect(agentSigner).updateInitialEpoch(initialEpoch);

  const elRewardsVaultBalance = await ethers.provider.getBalance(elRewardsVault.address);

  const withdrawalAmount = ether("1");

  await lido.connect(user1).approve(withdrawalQueue.address, withdrawalAmount);
  const tx = await withdrawalQueue.connect(user1).requestWithdrawals([withdrawalAmount], user1.address);
  const receipt = await tx.wait();
  if (receipt === null) {
    throw new Error(`Failed with:\n${tx}`);
  }

  const requestId = findEvents(receipt, "WithdrawalRequested")[0].args.requestId;

  log.success("Withdrawal request made");

  const epochsPerFrame = (await hashConsensusForAO.getFrameConfig()).epochsPerFrame;
  const initialEpochTimestamp = genesisTime + initialEpoch * slotsPerEpoch * secondsPerSlot;

  // skip two reports to be sure about REQUEST_TIMESTAMP_MARGIN
  const nextReportEpochTimestamp = initialEpochTimestamp + 2n * epochsPerFrame * slotsPerEpoch * secondsPerSlot;

  const timeToWaitTillReportWindow = nextReportEpochTimestamp - latestBlockTimestamp + secondsPerSlot;

  await advanceChainTime(parseInt(timeToWaitTillReportWindow.toString()));

  const stat = await lido.getBeaconStat();
  // const clBalance = toBN(stat.depositedValidators).mul(toBN(e18(32)));
  const clBalance = BigInt(stat.depositedValidators) * ether("32");

  const { refSlot } = await hashConsensusForAO.getCurrentFrame();
  const reportTimestamp = genesisTime + refSlot * secondsPerSlot;
  const timeElapsed = nextReportEpochTimestamp - initialEpochTimestamp;

  const withdrawalFinalizationBatches = [1];

  const accountingOracleSigner = await ethers.provider.getSigner(accountingOracle.address);
  // Performing dry-run to estimate simulated share rate
  const [postTotalPooledEther, postTotalShares, ,] = await lido
    .connect(accountingOracleSigner)
    .handleOracleReport.staticCall(
      reportTimestamp,
      timeElapsed,
      stat.depositedValidators,
      clBalance,
      0 /* withdrawals vault balance */,
      elRewardsVaultBalance,
      0 /* shares requested to burn */,
      [] /* withdrawal finalization batches */,
      0 /* simulated share rate */,
    );

  log.success("Oracle report simulated");

  const simulatedShareRate = (postTotalPooledEther * 10n ** 27n) / postTotalShares;

  await reportOracle(hashConsensusForAO, accountingOracle, {
    refSlot,
    numValidators: stat.depositedValidators,
    clBalance,
    elRewardsVaultBalance,
    withdrawalFinalizationBatches,
    simulatedShareRate,
  });

  log.success("Oracle report submitted");

  await withdrawalQueue.connect(user1).claimWithdrawalsTo([requestId], [requestId], user1.address);

  log.success("Withdrawal claimed successfully");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
