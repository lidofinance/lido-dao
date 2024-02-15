import { expect } from "chai";
import { ethers } from "hardhat";
import { de0x, dummyLocator } from "lib/dummy";
// import { keccak256, AbiCoder } from "ethers";

import {
  WithdrawalVault__factory,
  // PriorityExitBus__factory,
  // Prover__factory,
  Lido__factory,
  Lido,
  WithdrawalVault,
  // PriorityExitBus,
  // Prover,
  ValidatorsExitBusOracle__factory,
  ValidatorsExitBusOracle,
} from "typechain-types";

const pad = (hex, bytesLength, fill = "0") => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length;
  if (absentZeroes > 0) hex = "0x" + fill.repeat(absentZeroes) + hex.substr(2);
  return hex;
};

// const SLOTS_PER_EPOCH = 32
const SECONDS_PER_SLOT = 12;
const GENESIS_TIME = 100;

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

// function calcValidatorsExitBusReportDataHash(reportItems) {
//   return keccak256(new AbiCoder().encode(
//     ['(uint256,uint256,uint256,uint256,bytes)'],
//     [reportItems]
//   ))
// }

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

  let lido: Lido;
  let withdrawalVault: WithdrawalVault;
  // let priorityExitBus: PriorityExitBus
  // let prover: Prover
  let oracle: ValidatorsExitBusOracle;
  let locator: LidoLocator;

  // let oracleVersion: bigint;

  before(async () => {
    [deployer] = await ethers.getSigners();

    const lidoFactory = new Lido__factory(deployer);
    lido = await lidoFactory.deploy();
    const treasury = await lido.getAddress();

    // const priorityExitBusFactory = new PriorityExitBus__factory(deployer)
    // priorityExitBus = await priorityExitBusFactory.deploy()

    const withdrawalVaultFactory = new WithdrawalVault__factory(deployer);
    withdrawalVault = await withdrawalVaultFactory.deploy(await lido.getAddress(), treasury);

    // const proverFactory = new Prover__factory(deployer)
    // prover = await proverFactory.deploy()

    locator = await dummyLocator({
      withdrawalVault: await withdrawalVault.getAddress(),
    });
    const validatorsExitBusOracleFactory = new ValidatorsExitBusOracle__factory(deployer);
    oracle = await validatorsExitBusOracleFactory.deploy(SECONDS_PER_SLOT, GENESIS_TIME, locator);

    // oracleVersion = await oracle.getContractVersion()
  });

  context("stage1", () => {
    it("delayed keys", async () => {
      const moduleId = 5;
      const nodeOpId = 1;
      const valIndex = 10;
      const valPubkey = pad("0x010203", 48);
      const tx = await withdrawalVault.forcedExit(moduleId, nodeOpId, valIndex, valPubkey);

      await expect(tx).to.be.emit(withdrawalVault, "TriggerableExit");

      const refSlot = 100; //await consensus.getCurrentFrame()

      const exitRequests = [{ moduleId, nodeOpId, valIndex, valPubkey }];

      const reportFields = getDefaultReportFields({
        refSlot: +refSlot,
        requestsCount: exitRequests.length,
        data: encodeExitRequestsDataList(exitRequests),
      });

      const reportItems = getValidatorsExitBusReportDataItems(reportFields);
      // const reportHash = calcValidatorsExitBusReportDataHash(reportItems)

      //oracle report
      const tx2 = await oracle.submitReportData(reportFields, 1);

      await expect(tx2).to.be.emit(oracle, "ValidatorExitRequest");

      const valPubkeyUnknown = pad("0x010101", 48);

      console.log({
        reports: await oracle.reports(refSlot),
      });

      await expect(
        oracle.forcedExitFromRefSlot(moduleId, nodeOpId, valIndex, valPubkeyUnknown, reportItems),
      ).to.revertedWithCustomError(oracle, "InvalidPubkeyInReport");

      await oracle.forcedExitFromRefSlot(moduleId, nodeOpId, valIndex, valPubkey, reportItems);

      /**
       * 1. Оракул репортит ключи на выход - ключи попадают в VEBO
       * 2. VEBO сохраняем refSLot -> reporthash
       * 3. Stranger приносит пруф WC.forcedExit(pubkey, reportData) - если pubkey был в VEBO.reportData - тригерим
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
      // timeTracel
    });

    it("governance vote", async () => {});

    it("prover1 test", async () => {});
  });
});
