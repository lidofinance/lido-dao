import { bigintToHex, bufToHex } from "bigint-conversion";
import { expect } from "chai";
import { hexlify, randomBytes, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  BeaconChainDepositor,
  BeaconChainDepositor__factory,
  DepositContract__MockForBeaconChainDepositor,
  DepositContract__MockForBeaconChainDepositor__factory,
  StakingModule__Mock,
  StakingModule__Mock__factory,
  StakingRouter,
  StakingRouter__factory,
} from "typechain-types";

import { certainAddress, ether, getNextBlock, proxify, randomString } from "lib/proxy";

describe("StakingRouter", () => {
  let deployer: HardhatEthersSigner;
  let proxyAdmin: HardhatEthersSigner;
  let stakingRouterAdmin: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let depositContract: DepositContract__MockForBeaconChainDepositor;
  let beaconChainDepositor: BeaconChainDepositor;
  let stakingRouterImpl: StakingRouter;
  let stakingRouter: StakingRouter;

  const lido = certainAddress("test:staking-router:lido");
  const withdrawalCredentials = hexlify(randomBytes(32));

  beforeEach(async () => {
    [deployer, proxyAdmin, stakingRouterAdmin, user] = await ethers.getSigners();

    depositContract = await new DepositContract__MockForBeaconChainDepositor__factory(deployer).deploy();
    beaconChainDepositor = await new BeaconChainDepositor__factory(deployer).deploy(depositContract);
    stakingRouterImpl = await new StakingRouter__factory(deployer).deploy(beaconChainDepositor);
    [stakingRouter] = await proxify({ impl: stakingRouterImpl, admin: proxyAdmin, caller: user });
  });

  context("initialize", () => {
    it("Reverts if admin is zero address", async () => {
      await expect(stakingRouter.initialize(ZeroAddress, lido, withdrawalCredentials))
        .to.be.revertedWithCustomError(stakingRouter, "ZeroAddress")
        .withArgs("_admin");
    });

    it("Reverts if lido is zero address", async () => {
      await expect(stakingRouter.initialize(stakingRouterAdmin.address, ZeroAddress, withdrawalCredentials))
        .to.be.revertedWithCustomError(stakingRouter, "ZeroAddress")
        .withArgs("_lido");
    });

    it("Initializes the contract version, sets up roles and variables", async () => {
      await expect(stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials))
        .to.emit(stakingRouter, "ContractVersionSet")
        .withArgs(1)
        .and.to.emit(stakingRouter, "RoleGranted")
        .withArgs(await stakingRouter.DEFAULT_ADMIN_ROLE(), stakingRouterAdmin.address, user.address)
        .and.to.emit(stakingRouter, "WithdrawalCredentialsSet")
        .withArgs(withdrawalCredentials, user.address);

      expect(await stakingRouter.getContractVersion()).to.equal(1);
      expect(await stakingRouter.getLido()).to.equal(lido);
      expect(await stakingRouter.getWithdrawalCredentials()).to.equal(withdrawalCredentials);
    });
  });

  context("receive", () => {
    it("Reverts", async () => {
      await expect(
        user.sendTransaction({
          to: stakingRouter,
          value: ether("1.0"),
        }),
      ).to.be.revertedWithCustomError(stakingRouter, "DirectETHTransfer");
    });
  });

  context("getLido", () => {
    it("Returns zero address before initialization", async () => {
      expect(await stakingRouter.getLido()).to.equal(ZeroAddress);
    });

    it("Returns lido address after initialization", async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);

      expect(await stakingRouter.getLido()).to.equal(lido);
    });
  });

  context("addStakingModule", () => {
    const NAME = "StakingModule";
    const ADDRESS = certainAddress("test:staking-router:staking-module");
    const TARGET_SHARE = 1_00n;
    const MODULE_FEE = 5_00n;
    const TREASURY_FEE = 5_00n;

    beforeEach(async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);
      stakingRouter = stakingRouter.connect(stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.STAKING_MODULE_MANAGE_ROLE());
    });

    it("Reverts if the target share is greater than 100%", async () => {
      const TARGET_SHARE_OVER_100 = 100_01;

      await expect(stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE_OVER_100, MODULE_FEE, TREASURY_FEE))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_targetShare");
    });

    it("Reverts if the sum of module and treasury fees is greater than 100%", async () => {
      const MODULE_FEE_INVALID = 100_01n - TREASURY_FEE;

      await expect(stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE_INVALID, TREASURY_FEE))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_stakingModuleFee + _treasuryFee");

      const TREASURY_FEE_INVALID = 100_01n - MODULE_FEE;

      await expect(stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE_INVALID))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_stakingModuleFee + _treasuryFee");
    });

    it("Reverts if the staking module address is zero address", async () => {
      await expect(stakingRouter.addStakingModule(NAME, ZeroAddress, TARGET_SHARE, MODULE_FEE, TREASURY_FEE))
        .to.be.revertedWithCustomError(stakingRouter, "ZeroAddress")
        .withArgs("_stakingModuleAddress");
    });

    it("Reverts if the staking module name is empty string", async () => {
      const NAME_EMPTY_STRING = "";

      await expect(
        stakingRouter.addStakingModule(NAME_EMPTY_STRING, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE),
      ).to.be.revertedWithCustomError(stakingRouter, "StakingModuleWrongName");
    });

    it("Reverts if the number of staking modules is reached", async () => {
      const MAX_STAKING_MODULE_NAME_LENGTH = await stakingRouter.MAX_STAKING_MODULE_NAME_LENGTH();
      const NAME_TOO_LONG = randomString(Number(MAX_STAKING_MODULE_NAME_LENGTH + 1n));

      await expect(
        stakingRouter.addStakingModule(NAME_TOO_LONG, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE),
      ).to.be.revertedWithCustomError(stakingRouter, "StakingModuleWrongName");
    });

    it("Reverts if the max number of staking modules is reached", async () => {
      const MAX_STAKING_MODULES_COUNT = await stakingRouter.MAX_STAKING_MODULES_COUNT();

      for (let i = 0; i < MAX_STAKING_MODULES_COUNT; i++) {
        await stakingRouter.addStakingModule(
          randomString(8),
          certainAddress(`test:staking-router:staking-module-${i}`),
          1_00,
          1_00,
          1_00,
        );
      }

      expect(await stakingRouter.getStakingModulesCount()).to.equal(MAX_STAKING_MODULES_COUNT);

      await expect(
        stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE),
      ).to.be.revertedWithCustomError(stakingRouter, "StakingModulesLimitExceeded");
    });

    it("Reverts if adding a module with the same address", async () => {
      await stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE);

      await expect(
        stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE),
      ).to.be.revertedWithCustomError(stakingRouter, "StakingModuleAddressExists");
    });

    it("Adds the module to stakingRouter and emits events", async () => {
      const stakingModuleId = (await stakingRouter.getStakingModulesCount()) + 1n;
      const moduleAddedBlock = await getNextBlock();

      await expect(stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE))
        .to.be.emit(stakingRouter, "StakingRouterETHDeposited")
        .withArgs(stakingModuleId, 0)
        .and.to.be.emit(stakingRouter, "StakingModuleAdded")
        .withArgs(stakingModuleId, ADDRESS, NAME, stakingRouterAdmin.address)
        .and.to.be.emit(stakingRouter, "StakingModuleTargetShareSet")
        .withArgs(stakingModuleId, TARGET_SHARE, stakingRouterAdmin.address)
        .and.to.be.emit(stakingRouter, "StakingModuleFeesSet")
        .withArgs(stakingModuleId, MODULE_FEE, TREASURY_FEE, stakingRouterAdmin.address);

      expect(await stakingRouter.getStakingModule(stakingModuleId)).to.deep.equal([
        stakingModuleId,
        ADDRESS,
        MODULE_FEE,
        TREASURY_FEE,
        TARGET_SHARE,
        0n, // status active
        NAME,
        moduleAddedBlock.timestamp,
        moduleAddedBlock.number,
        0n, // exited validators
      ]);
    });
  });

  context("updateStakingModule", () => {
    const NAME = "StakingModule";
    let ID: bigint;
    let ADDRESS: string;
    const TARGET_SHARE = 1_00n;
    const MODULE_FEE = 5_00n;
    const TREASURY_FEE = 5_00n;

    const NEW_TARGET_SHARE = 2_00;
    const NEW_MODULE_FEE = 6_00n;
    const NEW_TREASURY_FEE = 4_00n;

    let stakingModule: StakingModule__Mock;

    beforeEach(async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);
      stakingRouter = stakingRouter.connect(stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);

      stakingModule = await new StakingModule__Mock__factory(deployer).deploy();
      ADDRESS = await stakingModule.getAddress();

      await stakingRouter.addStakingModule(NAME, ADDRESS, TARGET_SHARE, MODULE_FEE, TREASURY_FEE);
      ID = await stakingRouter.getStakingModulesCount();
    });

    it("Reverts if the caller does not have the role", async () => {
      stakingRouter = stakingRouter.connect(user);

      await expect(
        stakingRouter.updateStakingModule(ID, NEW_TARGET_SHARE, NEW_MODULE_FEE, NEW_TREASURY_FEE),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.STAKING_MODULE_MANAGE_ROLE());
    });

    it("Reverts if the new target share is greater than 100%", async () => {
      const NEW_TARGET_SHARE_OVER_100 = 100_01;
      await expect(stakingRouter.updateStakingModule(ID, NEW_TARGET_SHARE_OVER_100, NEW_MODULE_FEE, NEW_TREASURY_FEE))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_targetShare");
    });

    it("Reverts if the sum of the new module and treasury fees is greater than 100%", async () => {
      const NEW_MODULE_FEE_INVALID = 100_01n - TREASURY_FEE;

      await expect(stakingRouter.updateStakingModule(ID, TARGET_SHARE, NEW_MODULE_FEE_INVALID, TREASURY_FEE))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_stakingModuleFee + _treasuryFee");

      const NEW_TREASURY_FEE_INVALID = 100_01n - MODULE_FEE;
      await expect(stakingRouter.updateStakingModule(ID, TARGET_SHARE, MODULE_FEE, NEW_TREASURY_FEE_INVALID))
        .to.be.revertedWithCustomError(stakingRouter, "ValueOver100Percent")
        .withArgs("_stakingModuleFee + _treasuryFee");
    });

    it("Update target share, module and treasury fees and emits events", async () => {
      await expect(stakingRouter.updateStakingModule(ID, NEW_TARGET_SHARE, NEW_MODULE_FEE, NEW_TREASURY_FEE))
        .to.be.emit(stakingRouter, "StakingModuleTargetShareSet")
        .withArgs(ID, NEW_TARGET_SHARE, stakingRouterAdmin.address)
        .and.to.be.emit(stakingRouter, "StakingModuleFeesSet")
        .withArgs(ID, NEW_MODULE_FEE, NEW_TREASURY_FEE, stakingRouterAdmin.address);
    });
  });

  context("updateTargetValidatorsLimits", () => {
    let MODULE_ID: bigint;
    let stakingModule: StakingModule__Mock;

    const NODE_OPERATOR_ID = 1n;
    const IS_TARGET_LIMIT_ACTIVE = true;
    const TARGET_LIMIT = 100n;

    beforeEach(async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);
      stakingRouter = stakingRouter.connect(stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);

      stakingModule = await new StakingModule__Mock__factory(deployer).deploy();

      await stakingRouter.addStakingModule("myStakingModule", await stakingModule.getAddress(), 1_00, 5_00, 5_00);
      MODULE_ID = await stakingRouter.getStakingModulesCount();
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .updateTargetValidatorsLimits(MODULE_ID, NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.STAKING_MODULE_MANAGE_ROLE());
    });

    it("Redirects the call to the staking module", async () => {
      await expect(
        stakingRouter.updateTargetValidatorsLimits(MODULE_ID, NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT),
      )
        .to.emit(stakingModule, "Mock__TargetValidatorsLimitsUpdated")
        .withArgs(NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT);
    });
  });

  context("reportRewardsMinted", () => {
    let MODULE_ID: bigint;
    let stakingModule: StakingModule__Mock;

    beforeEach(async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);
      stakingRouter = stakingRouter.connect(stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.REPORT_REWARDS_MINTED_ROLE(), stakingRouterAdmin);

      stakingModule = await new StakingModule__Mock__factory(deployer).deploy();

      await stakingRouter.addStakingModule("myStakingModule", await stakingModule.getAddress(), 1_00, 5_00, 5_00);
      MODULE_ID = await stakingRouter.getStakingModulesCount();
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).reportRewardsMinted([MODULE_ID], [0n]),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_REWARDS_MINTED_ROLE());
    });

    it("Reverts if the arrays have different lengths", async () => {
      await expect(stakingRouter.reportRewardsMinted([MODULE_ID], [0n, 1n]))
        .to.be.revertedWithCustomError(stakingRouter, "ArraysLengthMismatch")
        .withArgs(1n, 2n);
    });

    it("Does nothing if the total shares is 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([MODULE_ID], [0n])).not.to.emit(
        stakingModule,
        "Mock__OnRewardsMinted",
      );
    });

    it("Does nothing if the total shares is 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([MODULE_ID], [0n])).not.to.emit(
        stakingModule,
        "Mock__OnRewardsMinted",
      );
    });

    it("Calls the hook on the staking module if the total shares is greater than 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([MODULE_ID], [1n]))
        .to.emit(stakingModule, "Mock__OnRewardsMinted")
        .withArgs(1n);
    });

    it("Reverts if the hook fails without revert data", async () => {
      await stakingModule.mock__revertOnRewardsMinted(true, "");

      await expect(stakingRouter.reportRewardsMinted([MODULE_ID], [1n])).to.be.revertedWithCustomError(
        stakingRouter,
        "UnrecoverableModuleError",
      );
    });

    it("Logs the revert data if the hook fails", async () => {
      // TODO
    });
  });

  context("updateExitedValidatorsCountByStakingModule", () => {
    let MODULE_ID: bigint;
    let stakingModule: StakingModule__Mock;

    beforeEach(async () => {
      await stakingRouter.initialize(stakingRouterAdmin.address, lido, withdrawalCredentials);
      stakingRouter = stakingRouter.connect(stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);
      await stakingRouter.grantRole(await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE(), stakingRouterAdmin);

      stakingModule = await new StakingModule__Mock__factory(deployer).deploy();

      await stakingRouter.addStakingModule("myStakingModule", await stakingModule.getAddress(), 1_00, 5_00, 5_00);
      MODULE_ID = await stakingRouter.getStakingModulesCount();
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).updateExitedValidatorsCountByStakingModule([MODULE_ID], [0n]),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the array lengths are different", async () => {
      await expect(stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [0n, 1n]))
        .to.be.revertedWithCustomError(stakingRouter, "ArraysLengthMismatch")
        .withArgs(1n, 2n);
    });

    it("Reverts if the new number of exited validators is less than the previous one", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [totalExitedValidators]);

      await expect(
        stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [totalExitedValidators - 1n]),
      ).to.be.revertedWithCustomError(stakingRouter, "ExitedValidatorsCountCannotDecrease");
    });

    it("Reverts if the new number of exited validators exceeds the number of deposited", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [totalExitedValidators]);

      const newExitedValidatorsExceedingDeposited = totalDepositedValidators + 1n;
      await expect(
        stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [newExitedValidatorsExceedingDeposited]),
      )
        .to.be.revertedWithCustomError(stakingRouter, "ReportedExitedValidatorsExceedDeposited")
        .withArgs(newExitedValidatorsExceedingDeposited, totalDepositedValidators);
    });

    it("Logs an event if the total exited validators is less than the previously reported number", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      const previouslyReportedTotalExitedValidators = totalExitedValidators + 1n;
      await stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [totalExitedValidators + 1n]);

      const newTotalExitedValidators = totalExitedValidators + 1n;

      await expect(stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [newTotalExitedValidators]))
        .to.be.emit(stakingRouter, "StakingModuleExitedValidatorsIncompleteReporting")
        .withArgs(MODULE_ID, previouslyReportedTotalExitedValidators - totalExitedValidators);
    });

    it("Logs an event if the total exited validators is less than the previously reported number", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([MODULE_ID], [totalExitedValidators]);

      const newTotalExitedValidators = totalExitedValidators + 1n;

      const newlyExitedValidatorsCount = await stakingRouter.updateExitedValidatorsCountByStakingModule.staticCall(
        [MODULE_ID],
        [newTotalExitedValidators],
      );

      expect(newlyExitedValidatorsCount).to.equal(1n);
    });
  });

  context("reportStakingModuleExitedValidatorsCountByNodeOperator", () => {
    let moduleId: bigint;
    let stakingModule: StakingModule__Mock;

    const NODE_OPERATOR_IDS = bigintToHex(1n, true, 8);
    const VALIDATORS_COUNTS = bigintToHex(100n, true, 16);

    beforeEach(async () => {
      ({ stakingModule, moduleId } = await setupModule(await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE()));
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .reportStakingModuleExitedValidatorsCountByNodeOperator(moduleId, NODE_OPERATOR_IDS, VALIDATORS_COUNTS),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the node operators ids are packed incorrectly", async () => {
      const incorrectlyPackedNodeOperatorIds = bufToHex(new Uint8Array([1]), true, 7);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          incorrectlyPackedNodeOperatorIds,
          VALIDATORS_COUNTS,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the validator counts are packed incorrectly", async () => {
      const incorrectlyPackedValidatorCounts = bufToHex(new Uint8Array([100]), true, 15);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          incorrectlyPackedValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = VALIDATORS_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = VALIDATORS_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the node operators ids is empty", async () => {
      await expect(stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(moduleId, "0x", "0x"))
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(1n);
    });

    it("Updates exited validator count on the module", async () => {
      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          VALIDATORS_COUNTS,
        ),
      )
        .to.emit(stakingModule, "Mock__ExitedValidatorsCountUpdated")
        .withArgs(NODE_OPERATOR_IDS, VALIDATORS_COUNTS);
    });
  });

  context("unsafeSetExitedValidatorsCount", () => {
    let moduleId: bigint;
    let stakingModule: StakingModule__Mock;

    const nodeOperatorId = 1n;

    const correction: StakingRouter.ValidatorsCountsCorrectionStruct = {
      currentModuleExitedValidatorsCount: 0n,
      currentNodeOperatorExitedValidatorsCount: 0n,
      currentNodeOperatorStuckValidatorsCount: 0n,
      newModuleExitedValidatorsCount: 1n,
      newNodeOperatorExitedValidatorsCount: 2n,
      newNodeOperatorStuckValidatorsCount: 3n,
    };

    beforeEach(async () => {
      ({ stakingModule, moduleId } = await setupModule(await stakingRouter.UNSAFE_SET_EXITED_VALIDATORS_ROLE()));
    });

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, correction),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.UNSAFE_SET_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the numbers of exited validators does not match what is stored on the contract", async () => {
      await expect(
        stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, {
          ...correction,
          currentModuleExitedValidatorsCount: 1n,
        }),
      )
        .to.be.revertedWithCustomError(stakingRouter, "UnexpectedCurrentValidatorsCount")
        .withArgs(0n, 0n, 0n);
    });

    it("Update unsafely the number of exited validators on the staking module", async () => {
      await expect(stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, correction))
        .to.be.emit(stakingModule, "Mock__ValidatorsCountUnsafelyUpdated")
        .withArgs(
          moduleId,
          correction.newNodeOperatorExitedValidatorsCount,
          correction.newNodeOperatorStuckValidatorsCount,
        );
    });
  });

  async function setupModule(role: string) {
    await stakingRouter.initialize(stakingRouterAdmin, lido, withdrawalCredentials);

    stakingRouter = stakingRouter.connect(stakingRouterAdmin);
    await stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), stakingRouterAdmin);

    const stakingModule = await new StakingModule__Mock__factory(deployer).deploy();

    await stakingRouter.addStakingModule("myStakingModule", await stakingModule.getAddress(), 1_00, 5_00, 5_00);
    const moduleId = await stakingRouter.getStakingModulesCount();

    await stakingRouter.grantRole(role, stakingRouterAdmin);

    return {
      stakingModule,
      moduleId,
    };
  }
});
