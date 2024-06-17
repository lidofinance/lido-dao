import { expect } from "chai";
import { encodeBytes32String, MaxUint256, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { Lido__factory, LidoLocator, NodeOperatorsRegistry, NodeOperatorsRegistry__factory } from "typechain-types";

import { dummyLocator, proxify, Snapshot } from "lib";

describe("NodeOperatorsRegistry", () => {
  let deployer: HardhatEthersSigner;

  let nor: NodeOperatorsRegistry;

  let originalState: string;

  before(async () => {
    [deployer] = await ethers.getSigners();
    const factory = new NodeOperatorsRegistry__factory(deployer);
    const impl = await factory.deploy();

    expect(await impl.getInitializationBlock()).to.equal(MaxUint256);
    [nor] = await proxify({ impl, admin: deployer });
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("initialize", () => {
    //const contractVersion = 2n;
    const moduleType = encodeBytes32String("curated-onchain-v1");

    let lidoAddress: string;
    let burnerAddress: string;
    let locator: LidoLocator;

    beforeEach(async () => {
      locator = await dummyLocator();

      lidoAddress = await locator.lido();
      burnerAddress = await locator.burner();
    });

    it("Reverts if Locator is zero address", async () => {
      await expect(nor.initialize(ZeroAddress, moduleType, 43200n)).to.be.reverted;
    });

    it("Reverts if stuck penalty delay exceeds MAX_STUCK_PENALTY_DELAY", async () => {
      const MAX_STUCK_PENALTY_DELAY = await nor.MAX_STUCK_PENALTY_DELAY();
      await expect(nor.initialize(locator, "curated-onchain-v1", MAX_STUCK_PENALTY_DELAY + 1n));
    });

    it("Reverts if already initialized", async () => {
      const MAX_STUCK_PENALTY_DELAY = await nor.MAX_STUCK_PENALTY_DELAY();
      await nor.initialize(locator, encodeBytes32String("curated-onchain-v1"), MAX_STUCK_PENALTY_DELAY);

      await expect(nor.initialize(locator, moduleType, MAX_STUCK_PENALTY_DELAY)).to.be.revertedWith(
        "INIT_ALREADY_INITIALIZED",
      );
    });

    it("Makes the contract initialized to v2", async () => {
      const latestBlock = BigInt(await time.latestBlock());
      const lido = Lido__factory.connect(lidoAddress);

      await expect(nor.initialize(locator, moduleType, 86400n))
        .to.emit(nor, "ContractVersionSet")
        .withArgs(2n)
        .and.to.emit(nor, "StuckPenaltyDelayChanged")
        .withArgs(86400n)
        .and.to.emit(nor, "LocatorContractSet")
        .withArgs(await locator.getAddress())
        .and.to.emit(nor, "StakingModuleTypeSet")
        .withArgs("curated-onchain-v1");

      expect(await nor.getLocator()).to.equal(await locator.getAddress());
      expect(await nor.getInitializationBlock()).to.equal(latestBlock + 1n);
      expect(await lido.allowance(await nor.getAddress(), burnerAddress)).to.equal(MaxUint256);
      expect(await nor.getStuckPenaltyDelay()).to.equal(86400n);
      expect(await nor.getContractVersion()).to.equal(2n);
      expect(await nor.getType()).to.equal(moduleType);
    });
  });

  context("finalizeUpgrade_v2", () => {});

  context("addNodeOperator", () => {});

  context("activateNodeOperator", () => {});

  context("deactivateNodeOperator", () => {});

  context("setNodeOperatorName", () => {});

  context("setNodeOperatorRewardAddress", () => {});

  context("setNodeOperatorStakingLimit", () => {});

  context("onRewardsMinted", () => {});

  context("updateStuckValidatorsCount", () => {});

  context("updateExitedValidatorsCount", () => {});

  context("updateRefundedValidatorsCount", () => {});

  context("onExitedAndStuckValidatorsCountsUpdated", () => {});

  context("unsafeUpdateValidatorsCount", () => {});

  context("updateTargetValidatorsLimits", () => {});

  context("onWithdrawalCredentialsChanged", () => {});

  context("invalidateReadyToDepositKeysRange", () => {});

  context("obtainDepositData", () => {});

  context("getNodeOperator", () => {});

  context("getRewardsDistribution", () => {});

  context("addSigningKeys", () => {});

  context("addSigningKeysOperatorBH", () => {});

  context("removeSigningKey", () => {});

  context("removeSigningKeys", () => {});

  context("removeSigningKeyOperatorBH", () => {});

  context("removeSigningKeysOperatorBH", () => {});

  context("getTotalSigningKeyCount", () => {});

  context("getUnusedSigningKeyCount", () => {});

  context("getSigningKey", () => {});

  context("getSigningKeys", () => {});

  context("getType", () => {});

  context("getStakingModuleSummary", () => {});

  context("getNodeOperatorSummary", () => {});

  context("isOperatorPenalized", () => {});

  context("isOperatorPenaltyCleared", () => {});

  context("clearNodeOperatorPenalty", () => {});

  context("getNodeOperatorsCount", () => {});

  context("getActiveNodeOperatorsCount", () => {});

  context("getNodeOperatorIsActive", () => {});

  context("getNodeOperatorIds", () => {});

  context("getNonce", () => {});

  context("getKeysOpIndex", () => {});

  context("getLocator", () => {});

  context("getStuckPenaltyDelay", () => {});

  context("setStuckPenaltyDelay", () => {});
});
