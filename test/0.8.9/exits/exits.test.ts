import { expect } from "chai";
import { AbiCoder, keccak256 } from "ethers";
import { ethers } from "hardhat";

import {
  HashConsensusTimeTravellable__factory,
  Lido,
  Lido__factory,
  OracleReportSanityCheckerMock,
  OracleReportSanityCheckerMock__factory,
  TriggerableExit,
  TriggerableExit__factory,
  ValidatorsExitBusOracle,
  ValidatorsExitBusOracleMock__factory,
  WithdrawalVault,
  WithdrawalVault__factory,
} from "typechain-types";

import { ether, Snapshot } from "lib";
import { de0x, dummyLocator } from "lib/dummy";

const pad = (hex, bytesLength, fill = "0") => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length;
  if (absentZeroes > 0) hex = "0x" + fill.repeat(absentZeroes) + hex.substr(2);
  return hex;
};

const SLOTS_PER_EPOCH = 32;
const SECONDS_PER_SLOT = 12;
const GENESIS_TIME = 100;
const EPOCHS_PER_FRAME = 37;
const INITIAL_FAST_LANE_LENGTH_SLOTS = 0;
const INITIAL_EPOCH = 1;

const CONSENSUS_VERSION = 1;
const DATA_FORMAT_LIST = 1;

function genPublicKeysArray(cnt = 1) {
  const pubkeys = [];

  for (let i = 1; i <= cnt; i++) {
    pubkeys.push(pad("0x" + i.toString(16), 48));
  }
  return pubkeys;
}

// function genPublicKeysCalldata(cnt = 1) {
//   let pubkeys = '0x'

//   for (let i = 1; i <= cnt; i++) {
//     pubkeys = pubkeys + de0x(pad("0x" + i.toString(16), 48))
//   }
//   return pubkeys
// }

const getDefaultReportFields = (overrides) => ({
  consensusVersion: CONSENSUS_VERSION,
  dataFormat: DATA_FORMAT_LIST,
  // required override: refSlot
  // required override: requestsCount
  // required override: data
  ...overrides,
});

function calcValidatorsExitBusReportDataHash(reportItems) {
  return keccak256(new AbiCoder().encode(["(uint256,uint256,uint256,uint256,bytes)"], [reportItems]));
}

function getValidatorsExitBusReportDataItems(r) {
  return [r.consensusVersion, r.refSlot, r.requestsCount, r.dataFormat, r.data];
}
function hex(n, byteLen = undefined) {
  const s = n.toString(16);
  return byteLen === undefined ? s : s.padStart(byteLen * 2, "0");
}
function encodeExitRequestHex({ moduleId, nodeOpId, valIndex, valPubkey }) {
  const pubkeyHex = de0x(valPubkey);
  return hex(moduleId, 3) + hex(nodeOpId, 5) + hex(valIndex, 8) + pubkeyHex;
}

function encodeExitRequestsDataList(requests) {
  return "0x" + requests.map(encodeExitRequestHex).join("");
}

describe("Triggerable exits test", () => {
  let deployer: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let voting: HardhatEthersSigner;
  let member1: HardhatEthersSigner;
  let member2: HardhatEthersSigner;
  let member3: HardhatEthersSigner;

  let provider: typeof ethers.provider;

  let lido: Lido;
  let withdrawalVault: WithdrawalVault;
  let oracle: ValidatorsExitBusOracle;
  let locator: LidoLocator;
  let consensus: HashConsensus;
  let sanityChecker: OracleReportSanityCheckerMock;
  let triggerableExit: TriggerableExit;

  // let oracleVersion: bigint;

  async function getLatestBlock(): Promise<Block> {
    const block = await provider.getBlock("latest");
    if (!block) throw new Error("Failed to retrieve latest block");
    return block as Block;
  }

  async function triggerConsensusOnHash(hash) {
    const { refSlot } = await consensus.getCurrentFrame();
    await consensus.connect(member1).submitReport(refSlot, hash, CONSENSUS_VERSION);
    await consensus.connect(member3).submitReport(refSlot, hash, CONSENSUS_VERSION);

    const state = await consensus.getConsensusState();
    expect(state.consensusReport).to.be.equal(hash);
  }

  before(async () => {
    ({ provider } = ethers);
    [deployer, stranger, voting, member1, member2, member3] = await ethers.getSigners();

    const lidoFactory = new Lido__factory(deployer);
    lido = await lidoFactory.deploy();
    const treasury = await lido.getAddress();

    const triggerableExitFactory = new TriggerableExit__factory(deployer);
    triggerableExit = await triggerableExitFactory.deploy();

    const withdrawalVaultFactory = new WithdrawalVault__factory(deployer);
    withdrawalVault = await withdrawalVaultFactory.deploy(
      await lido.getAddress(),
      treasury,
      await triggerableExit.getAddress(),
    );

    // const proverFactory = new Prover__factory(deployer)
    // prover = await proverFactory.deploy()
    const sanityCheckerFactory = new OracleReportSanityCheckerMock__factory(deployer);
    sanityChecker = await sanityCheckerFactory.deploy();

    locator = await dummyLocator({
      withdrawalVault: await withdrawalVault.getAddress(),
      oracleReportSanityChecker: await sanityChecker.getAddress(),
    });
    const validatorsExitBusOracleFactory = new ValidatorsExitBusOracleMock__factory(deployer);
    oracle = await validatorsExitBusOracleFactory.deploy(SECONDS_PER_SLOT, GENESIS_TIME, locator);

    //consensus contract
    const consensusFactory = new HashConsensusTimeTravellable__factory(deployer);
    consensus = await consensusFactory.deploy(
      SLOTS_PER_EPOCH,
      SECONDS_PER_SLOT,
      GENESIS_TIME,
      EPOCHS_PER_FRAME,
      INITIAL_FAST_LANE_LENGTH_SLOTS,
      deployer,
      await oracle.getAddress(),
    );
    await consensus.updateInitialEpoch(INITIAL_EPOCH);
    await consensus.setTime(GENESIS_TIME + INITIAL_EPOCH * SLOTS_PER_EPOCH * SECONDS_PER_SLOT);

    await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), deployer);
    await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), deployer);
    await consensus.grantRole(await consensus.MANAGE_FRAME_CONFIG_ROLE(), deployer);
    await consensus.grantRole(await consensus.MANAGE_FAST_LANE_CONFIG_ROLE(), deployer);
    await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), deployer);

    const lastProcessingRefSlot = 0;
    await oracle.initialize(deployer, await consensus.getAddress(), CONSENSUS_VERSION, lastProcessingRefSlot);

    await oracle.grantRole(await oracle.SUBMIT_PRIORITY_DATA_ROLE(), voting);
    await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), deployer);
    await oracle.grantRole(await oracle.PAUSE_ROLE(), deployer);
    await oracle.grantRole(await oracle.RESUME_ROLE(), deployer);

    //add consensus members
    await consensus.addMember(member1, 1);
    await consensus.addMember(member2, 2);
    await consensus.addMember(member3, 2);

    //resume after deploy
    await oracle.resume();
  });

  context("stage1", () => {
    let originalState: string;

    beforeEach(async () => {
      originalState = await Snapshot.take();
    });
    afterEach(async () => {
      await Snapshot.restore(originalState);
    });

    it("reverts if oracle report does not have valPubkeyUnknown", async () => {
      const moduleId = 5;
      const moduleId2 = 1;
      const nodeOpId = 1;
      const nodeOpId2 = 1;
      const valIndex = 10;
      const valIndex2 = 11;
      const valPubkey = pad("0x010203", 48);
      const valPubkey2 = pad("0x010204", 48);

      const block = await getLatestBlock();
      await consensus.setTime(block.timestamp);

      const { refSlot } = await consensus.getCurrentFrame();

      const exitRequests = [
        { moduleId: moduleId2, nodeOpId: nodeOpId2, valIndex: valIndex2, valPubkey: valPubkey2 },
        { moduleId, nodeOpId, valIndex, valPubkey },
      ];

      const reportFields = getDefaultReportFields({
        refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
      });

      const reportItems = getValidatorsExitBusReportDataItems(reportFields);
      const reportHash = calcValidatorsExitBusReportDataHash(reportItems);

      await triggerConsensusOnHash(reportHash);

      //oracle report
      const tx2 = await oracle.submitReportData(reportFields, 1);
      await expect(tx2).to.be.emit(oracle, "ValidatorExitRequest");

      const valPubkeyUnknown = pad("0x010101", 48);

      await expect(oracle.forcedExitPubkey(valPubkeyUnknown, reportItems)).to.be.revertedWithCustomError(
        oracle,
        "ErrorInvalidPubkeyInReport",
      );
    });

    it("forced exit with oracle report works", async () => {
      const moduleId = 5;
      const moduleId2 = 1;
      const nodeOpId = 1;
      const nodeOpId2 = 1;
      const valIndex = 10;
      const valIndex2 = 11;
      const valPubkey = pad("0x010203", 48);
      const valPubkey2 = pad("0x010204", 48);

      const block = await getLatestBlock();
      await consensus.setTime(block.timestamp);

      const { refSlot } = await consensus.getCurrentFrame();

      const exitRequests = [
        { moduleId: moduleId2, nodeOpId: nodeOpId2, valIndex: valIndex2, valPubkey: valPubkey2 },
        { moduleId, nodeOpId, valIndex, valPubkey },
      ];

      const reportFields = getDefaultReportFields({
        refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
      });

      const reportItems = getValidatorsExitBusReportDataItems(reportFields);
      const reportHash = calcValidatorsExitBusReportDataHash(reportItems);

      await triggerConsensusOnHash(reportHash);

      //oracle report
      const tx2 = await oracle.submitReportData(reportFields, 1);
      await expect(tx2).to.be.emit(oracle, "ValidatorExitRequest");

      //maximum to exit - 600val
      const tx = await oracle.connect(stranger).forcedExitPubkey(valPubkey, reportItems, { value: ether("1.0") });
      await expect(tx).to.be.emit(oracle, "ValidatorForcedExitRequest");
      await expect(tx).to.be.emit(triggerableExit, "TriggerableExit");
    });

    it("governance vote without oracle.submitReportData works", async () => {
      const moduleId = 5;
      const moduleId2 = 1;
      const nodeOpId = 1;
      const nodeOpId2 = 1;
      const valIndex = 10;
      const valIndex2 = 11;
      const valPubkey = pad("0x010203", 48);
      const valPubkey2 = pad("0x010204", 48);

      const refSlot = 0; //await consensus.getCurrentFrame()
      const exitRequests = [
        { moduleId: moduleId2, nodeOpId: nodeOpId2, valIndex: valIndex2, valPubkey: valPubkey2 },
        { moduleId, nodeOpId, valIndex, valPubkey },
      ];

      const reportFields = getDefaultReportFields({
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
      });

      const reportItems = getValidatorsExitBusReportDataItems(reportFields);
      const reportHash = calcValidatorsExitBusReportDataHash(reportItems);

      //priority
      await oracle.connect(voting).submitPriorityReportData(reportHash, exitRequests.length);

      const tx = await oracle.connect(stranger).forcedExitPubkey(valPubkey, reportItems, { value: ether("1.0") });
      await expect(tx).to.be.emit(oracle, "ValidatorForcedExitRequest");
      await expect(tx).to.be.emit(triggerableExit, "TriggerableExit");
    });

    it("exit multiple keys", async () => {
      const keys = genPublicKeysArray(5);

      const refSlot = 0; //await consensus.getCurrentFrame()
      const exitRequests = [
        { moduleId: 1, nodeOpId: 1, valIndex: 0, valPubkey: keys[0] },
        { moduleId: 2, nodeOpId: 2, valIndex: 0, valPubkey: keys[1] },
        { moduleId: 3, nodeOpId: 3, valIndex: 0, valPubkey: keys[2] },
        { moduleId: 4, nodeOpId: 4, valIndex: 0, valPubkey: keys[3] },
        { moduleId: 5, nodeOpId: 5, valIndex: 0, valPubkey: keys[4] },
      ];

      const reportFields = getDefaultReportFields({
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
      });

      const reportItems = getValidatorsExitBusReportDataItems(reportFields);
      const reportHash = calcValidatorsExitBusReportDataHash(reportItems);

      //priority
      await oracle.connect(voting).submitPriorityReportData(reportHash, exitRequests.length);

      //check invalid request count
      const keysInvalidRequestCount = genPublicKeysArray(6);
      await expect(
        oracle.connect(stranger).forcedExitPubkeys(keysInvalidRequestCount, reportItems),
      ).to.be.revertedWithCustomError(oracle, "ErrorInvalidKeysRequestsCount");

      //check invalid request count
      const validRequestLessInTheReport = genPublicKeysArray(3);
      await expect(
        oracle.connect(stranger).forcedExitPubkeys(validRequestLessInTheReport, reportItems),
      ).not.to.be.revertedWithCustomError(oracle, "ErrorInvalidKeysRequestsCount");

      //check invalid request count
      const invalidKeyInRequest = [...keys];
      invalidKeyInRequest[2] = pad("0x010203", 48);
      await expect(
        oracle.connect(stranger).forcedExitPubkeys(invalidKeyInRequest, reportItems, { value: ether("1.0") }),
      ).to.be.revertedWithCustomError(oracle, "ErrorInvalidPubkeyInReport");

      //works
      await oracle.connect(stranger).forcedExitPubkeys(keys, reportItems, { value: ether("1.0") });
    });

    it("prover1 test", async () => {
      // 8
    });
  });
});
