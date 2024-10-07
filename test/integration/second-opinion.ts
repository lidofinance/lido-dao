import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { SecondOpinionOracleMock } from "typechain-types";

import { ether, impersonate, ONE_GWEI } from "lib";
import { getProtocolContext, ProtocolContext } from "lib/protocol";
import { finalizeWithdrawalQueue, norEnsureOperators, report, sdvtEnsureOperators } from "lib/protocol/helpers";

import { bailOnFailure, Snapshot } from "test/suite";

const AMOUNT = ether("100");
const MAX_DEPOSIT = 150n;
const CURATED_MODULE_ID = 1n;
const INITIAL_REPORTED_BALANCE = ether("32") * 3n; // 32 ETH * 3 validators
const DIFF_AMOUNT = ether("10");

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

    const { chainId } = await ethers.provider.getNetwork();
    // Sepolia-specific initialization
    if (chainId === 11155111n) {
      // Sepolia deposit contract address https://sepolia.etherscan.io/token/0x7f02c3e3c98b133055b8b348b2ac625669ed295d
      const sepoliaDepositContractAddress = "0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D";
      const bepoliaWhaleHolder = "0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134";
      const BEPOLIA_TO_TRANSFER = 20;

      const bepoliaToken = await ethers.getContractAt("ISepoliaDepositContract", sepoliaDepositContractAddress);
      const bepiloaSigner = await ethers.getImpersonatedSigner(bepoliaWhaleHolder);

      const adapterAddr = await ctx.contracts.stakingRouter.DEPOSIT_CONTRACT();
      await bepoliaToken.connect(bepiloaSigner).transfer(adapterAddr, BEPOLIA_TO_TRANSFER);
    }
    const dsmSigner = await impersonate(depositSecurityModule.address, AMOUNT);
    await lido.connect(dsmSigner).deposit(MAX_DEPOSIT, CURATED_MODULE_ID, ZERO_HASH);

    secondOpinion = await ethers.deployContract("SecondOpinionOracleMock", []);
    const soAddress = await secondOpinion.getAddress();

    const agentSigner = await ctx.getSigner("agent", AMOUNT);
    await oracleReportSanityChecker
      .connect(agentSigner)
      .grantRole(await oracleReportSanityChecker.SECOND_OPINION_MANAGER_ROLE(), agentSigner.address);

    await report(ctx, {
      clDiff: INITIAL_REPORTED_BALANCE,
      clAppearedValidators: 3n,
      excludeVaultsBalances: true,
    });

    await oracleReportSanityChecker.connect(agentSigner).setSecondOpinionOracleAndCLBalanceUpperMargin(soAddress, 74n);
  });

  beforeEach(bailOnFailure);

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  after(async () => await Snapshot.restore(snapshot)); // Rollback to the initial state pre deployment

  it("Should account correctly with no CL rebase", async () => {
    const { hashConsensus, accountingOracle, oracleReportSanityChecker } = ctx.contracts;

    // Report without second opinion is failing
    await expect(report(ctx, { clDiff: -DIFF_AMOUNT, excludeVaultsBalances: true })).to.be.revertedWithCustomError(
      oracleReportSanityChecker,
      "NegativeRebaseFailedSecondOpinionReportIsNotReady",
    );

    // Provide a second opinion
    const curFrame = await hashConsensus.getCurrentFrame();
    const expectedBalance = (INITIAL_REPORTED_BALANCE - DIFF_AMOUNT) / ONE_GWEI;
    await secondOpinion.addPlainReport(curFrame.reportProcessingDeadlineSlot, expectedBalance, 0n);

    const lastProcessingRefSlotBefore = await accountingOracle.getLastProcessingRefSlot();
    await report(ctx, { clDiff: -DIFF_AMOUNT, excludeVaultsBalances: true });
    const lastProcessingRefSlotAfter = await accountingOracle.getLastProcessingRefSlot();
    expect(lastProcessingRefSlotBefore).to.be.lessThan(
      lastProcessingRefSlotAfter,
      "LastProcessingRefSlot should be updated",
    );
  });
});
