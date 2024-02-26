import { expect } from "chai";
import { AbiCoder, keccak256 } from "ethers";
import { ethers } from "hardhat";

import {
  HashConsensusTimeTravellable__factory,
  Lido,
  Lido__factory,
  PriorityExitBus__factory,
  ValidatorsExitBusOracle,
  ValidatorsExitBusOracleMock__factory,
  WithdrawalVault,
  WithdrawalVault__factory,
} from "typechain-types";

import { Snapshot } from "lib";
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

// const PUBKEYS = [
//   '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
//   '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
//   '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
//   '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
//   '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
// ]

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

    const priorityExitBusFactory = new PriorityExitBus__factory(deployer);
    priorityExitBus = await priorityExitBusFactory.deploy();

    const withdrawalVaultFactory = new WithdrawalVault__factory(deployer);
    withdrawalVault = await withdrawalVaultFactory.deploy(await lido.getAddress(), treasury);

    // const proverFactory = new Prover__factory(deployer)
    // prover = await proverFactory.deploy()

    locator = await dummyLocator({
      withdrawalVault: await withdrawalVault.getAddress(),
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

      await expect(
        oracle.forcedExitFromReport(moduleId, nodeOpId, valIndex, valPubkeyUnknown, reportItems),
      ).to.be.revertedWithCustomError(oracle, "InvalidPubkeyInReport");

      /**
       * 1. Оракул репортит ключи на выход - ключи попадают в VEBO
       * 2. VEBO сохраняем refSLot -> reporthash
       * 3. Stranger приносит пруф oracle.forcedExit(pubkey, reportData) - если pubkey был в VEBO.reportData - тригерим
       *
       *
       *
       *
       *
       * 1. Оракул репортит ключи на выход - ключи попадают в VEBO
       * 2. VEBO сохраняем refSLot -> reporthash
       * 3. Stranger приносит пруф WC.forcedExit(pubkey, reportData) - если pubkey был в VEBO.reportData - тригерим
       *    3.1 Проверяем действительно ли есть stuck ключи, если есть - выводим
       *
       *
       *
       *
       * 1. Говернанс приносит ключи в PEB
       * 2. Простая очередь - добавляем эти ключи в PEB
       * 3. Кто смотрит в PEB? Как оракулл приоритезирует VEBO + PEB ? + надос сомтреть кого вывели
       *  или он сомтрит в PEB и все равно пихает в VEBO - а там уже есть Event()
       *
       *
       *
       *
       */
      // WC.forcedExit(pubkey) - false
      // StakingRouter.updateStuckValidatorsCount(pubkey) -
      // WC.forcedExit(pubkey) - false
      // timeTravel
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

      const tx = await withdrawalVault.forcedExit(moduleId, nodeOpId, valIndex, valPubkey);
      await expect(tx).to.be.emit(withdrawalVault, "TriggerableExit");

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
      await oracle.connect(stranger).forcedExitFromReport(moduleId, nodeOpId, valIndex, valPubkey, reportItems);
    });

    it("governance vote without submitReportData works", async () => {
      const moduleId = 5;
      const moduleId2 = 1;
      const nodeOpId = 1;
      const nodeOpId2 = 1;
      const valIndex = 10;
      const valIndex2 = 11;
      const valPubkey = pad("0x010203", 48);
      const valPubkey2 = pad("0x010204", 48);

      const tx = await withdrawalVault.forcedExit(moduleId, nodeOpId, valIndex, valPubkey);
      await expect(tx).to.be.emit(withdrawalVault, "TriggerableExit");

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

      //priority
      await oracle.connect(voting).submitPriorityReportData(reportItems);
      await oracle.connect(stranger).forcedExitFromReport(moduleId, nodeOpId, valIndex, valPubkey, reportItems);
    });

    it("prover1 test", async () => {
      // 8
    });
  });
});
