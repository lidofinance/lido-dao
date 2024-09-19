import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { SecondOpinionOracleMock } from "typechain-types";

import { ether, impersonate } from "lib";
import { getProtocolContext, ProtocolContext } from "lib/protocol";
import { finalizeWithdrawalQueue, norEnsureOperators, report, sdvtEnsureOperators } from "lib/protocol/helpers";

import { Snapshot } from "test/suite";

const AMOUNT = ether("100");
const MAX_DEPOSIT = 150n;
const CURATED_MODULE_ID = 1n;

const ZERO_HASH = new Uint8Array(32).fill(0);

describe("Second opinion", () => {
  let ctx: ProtocolContext;

  let ethHolder: HardhatEthersSigner;
  let stEthHolder: HardhatEthersSigner;

  let snapshot: string;
  let originalState: string;

  let secondOpinion: SecondOpinionOracleMock;

  before(async () => {
    ctx = await getProtocolContext();

    [stEthHolder, ethHolder] = await ethers.getSigners();

    snapshot = await Snapshot.take();

    const { lido, depositSecurityModule, oracleReportSanityChecker } = ctx.contracts;

    await finalizeWithdrawalQueue(ctx, stEthHolder, ethHolder);

    await norEnsureOperators(ctx, 3n, 5n);
    if (ctx.flags.withSimpleDvtModule) {
      await sdvtEnsureOperators(ctx, 3n, 5n);
    }

    // const sepoliaDepositContractAddress = "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D";
    // const bepoliaWhaleHolder = "0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134";
    // const BEPOLIA_TO_TRANSFER = 20;

    // const bepoliaToken = await ethers.getContractAt("ISepoliaDepositContract", sepoliaDepositContractAddress);
    // const bepiloaSigner = await ethers.getImpersonatedSigner(bepoliaWhaleHolder);

    // const adapterAddr = await ctx.contracts.stakingRouter.DEPOSIT_CONTRACT();
    // await bepoliaToken.connect(bepiloaSigner).transfer(adapterAddr, BEPOLIA_TO_TRANSFER);

    const dsmSigner = await impersonate(depositSecurityModule.address, AMOUNT);
    await lido.connect(dsmSigner).deposit(MAX_DEPOSIT, CURATED_MODULE_ID, ZERO_HASH);

    secondOpinion = await ethers.deployContract("SecondOpinionOracleMock", []);
    const soAddress = await secondOpinion.getAddress();
    console.log("second opinion address", soAddress);

    const sanityAddr = await oracleReportSanityChecker.getAddress();
    console.log("sanityAddr", sanityAddr);

    const agentSigner = await ctx.getSigner("agent", AMOUNT);
    await oracleReportSanityChecker
      .connect(agentSigner)
      .grantRole(await oracleReportSanityChecker.SECOND_OPINION_MANAGER_ROLE(), agentSigner.address);

    await report(ctx, {
      clDiff: ether("32") * 3n, // 32 ETH * 3 validators
      clAppearedValidators: 3n,
      excludeVaultsBalances: true,
    });

    await oracleReportSanityChecker.connect(agentSigner).setSecondOpinionOracleAndCLBalanceUpperMargin(soAddress, 74n);
    console.log("Finish init");
  });

  // beforeEach(bailOnFailure);

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  after(async () => await Snapshot.restore(snapshot)); // Rollback to the initial state pre deployment

  it("Should account correctly with no CL rebase", async () => {
    const { hashConsensus, accountingOracle } = ctx.contracts;

    const curFrame = await hashConsensus.getCurrentFrame();
    console.log("curFrame", curFrame);

    await secondOpinion.addPlainReport(curFrame.reportProcessingDeadlineSlot, 86000000000n, 0n);
    // await secondOpinion.addPlainReport(curFrame.refSlot, 86000000000n, 0n);
    const testReport = await secondOpinion.getReport(curFrame.refSlot);
    console.log("testReport refSlot", curFrame.refSlot, testReport);
    const testReport2 = await secondOpinion.getReport(curFrame.reportProcessingDeadlineSlot);
    console.log("testReport reportProcessingDeadlineSlot", curFrame.reportProcessingDeadlineSlot, testReport2);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    console.log("lastProcessingRefSlotBefore", lastProcessingRefSlotBefore.toString());
    // Report
    const params = { clDiff: ether("-10"), excludeVaultsBalances: true };

    // Tracing.enable();
    const { reportTx } = (await report(ctx, params)) as {
      reportTx: TransactionResponse;
      extraDataTx: TransactionResponse;
    };
    console.log("Finished report");

    const reportTxReceipt = (await reportTx.wait()) as ContractTransactionReceipt;
    console.log("reportTxReceipt", reportTxReceipt);

    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    console.log("lastProcessingRefSlotAfter", lastProcessingRefSlotAfter.toString());
    expect(lastProcessingRefSlotBefore).to.be.lessThan(
      lastProcessingRefSlotAfter,
      "LastProcessingRefSlot should be updated",
    );
  });
});
