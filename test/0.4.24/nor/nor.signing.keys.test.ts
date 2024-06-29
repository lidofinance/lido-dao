import { expect } from "chai";
import { BigNumberish, BytesLike, encodeBytes32String } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  ACL,
  Kernel,
  Lido,
  LidoLocator,
  LidoLocator__factory,
  NodeOperatorsRegistry__MockForFlow,
  NodeOperatorsRegistry__MockForFlow__factory,
} from "typechain-types";

import {
  addNodeOperator,
  certainAddress,
  EMPTY_PUBLIC_KEY,
  EMPTY_SIGNATURE,
  ether,
  FakeValidatorKeys,
  impersonate,
  NodeOperatorConfig,
} from "lib";

import { addAragonApp, deployLidoDao } from "test/deploy";
import { Snapshot } from "test/suite";

describe("NodeOperatorsRegistry", () => {
  const UINT64_MAX = 2n ** 64n - 1n;

  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let firstNOManager: HardhatEthersSigner;
  let secondNOManager: HardhatEthersSigner;

  let limitsManager: HardhatEthersSigner;
  let nodeOperatorsManager: HardhatEthersSigner;
  let signingKeysManager: HardhatEthersSigner;
  let stakingRouter: HardhatEthersSigner;
  let lido: Lido;
  let dao: Kernel;
  let acl: ACL;
  let locator: LidoLocator;

  let impl: NodeOperatorsRegistry__MockForFlow;
  let nor: NodeOperatorsRegistry__MockForFlow;

  let originalState: string;

  const NODE_OPERATORS: NodeOperatorConfig[] = [
    {
      name: "foo",
      rewardAddress: certainAddress("node-operator-1"),
      totalSigningKeysCount: 8n,
      depositedSigningKeysCount: 5n,
      exitedSigningKeysCount: 1n,
      vettedSigningKeysCount: 6n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
    {
      name: " bar",
      rewardAddress: certainAddress("node-operator-2"),
      totalSigningKeysCount: 12n,
      depositedSigningKeysCount: 7n,
      exitedSigningKeysCount: 0n,
      vettedSigningKeysCount: 10n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
    {
      name: " super large",
      rewardAddress: certainAddress("node-operator-3"),
      totalSigningKeysCount: UINT64_MAX - 20n,
      depositedSigningKeysCount: 0n,
      exitedSigningKeysCount: 0n,
      vettedSigningKeysCount: 5n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
  ];

  const moduleType = encodeBytes32String("curated-onchain-v1");
  const penaltyDelay = 86400n;
  const contractVersion = 2n;

  const firstNOKeys = new FakeValidatorKeys(5, { kFill: "a", sFill: "b" });
  const secondNOKeys = new FakeValidatorKeys(9, { kFill: "c", sFill: "d" });
  const thirdNOKeys = new FakeValidatorKeys(30, { kFill: "c", sFill: "d" });

  const firstNodeOperatorId = 0;
  const secondNodeOperatorId = 1;
  const thirdNodeOperatorId = 2;

  before(async () => {
    [deployer, user, stakingRouter, nodeOperatorsManager, signingKeysManager, limitsManager, stranger] =
      await ethers.getSigners();

    ({ lido, dao, acl } = await deployLidoDao({
      rootAccount: deployer,
      initialized: true,
      locatorConfig: {
        stakingRouter,
      },
    }));

    impl = await new NodeOperatorsRegistry__MockForFlow__factory(deployer).deploy();
    const appProxy = await addAragonApp({
      dao,
      name: "node-operators-registry",
      impl,
      rootAccount: deployer,
    });

    nor = NodeOperatorsRegistry__MockForFlow__factory.connect(appProxy, deployer);

    await acl.createPermission(user, lido, await lido.RESUME_ROLE(), deployer);

    await acl.createPermission(stakingRouter, nor, await nor.STAKING_ROUTER_ROLE(), deployer);
    await acl.createPermission(signingKeysManager, nor, await nor.MANAGE_SIGNING_KEYS(), deployer);
    await acl.createPermission(nodeOperatorsManager, nor, await nor.MANAGE_NODE_OPERATOR_ROLE(), deployer);
    await acl.createPermission(limitsManager, nor, await nor.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer);

    // grant role to nor itself cause it uses solidity's call method to itself
    // inside the testing_requestValidatorsKeysForDeposits() method
    await acl.grantPermission(nor, nor, await nor.STAKING_ROUTER_ROLE());

    locator = LidoLocator__factory.connect(await lido.getLidoLocator(), user);

    // Initialize the nor's proxy.
    await expect(nor.initialize(locator, moduleType, penaltyDelay))
      .to.emit(nor, "ContractVersionSet")
      .withArgs(contractVersion)
      .and.to.emit(nor, "LocatorContractSet")
      .withArgs(locator)
      .and.to.emit(nor, "StakingModuleTypeSet")
      .withArgs(moduleType);

    nor = nor.connect(user);

    firstNOManager = await impersonate(NODE_OPERATORS[firstNodeOperatorId].rewardAddress, ether("100.0"));
    secondNOManager = await impersonate(NODE_OPERATORS[secondNodeOperatorId].rewardAddress, ether("100.0"));
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  function addSigningKeysCases<TResult>(
    addKeysFn: (
      nor_instance: NodeOperatorsRegistry__MockForFlow,
      _nodeOperatorId: BigNumberish,
      _keysCount: BigNumberish,
      _publicKeys: BytesLike,
      _signatures: BytesLike,
    ) => TResult,
  ) {
    beforeEach(async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[firstNodeOperatorId])).to.be.equal(
        firstNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[secondNodeOperatorId])).to.be.equal(
        secondNodeOperatorId,
      );
    });

    it("Reverts if no such an operator exists", async () => {
      await expect(addKeysFn(nor, 5n, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE)).to.be.revertedWith("OUT_OF_RANGE");
    });

    it("Reverts if has no management rights", async () => {
      await expect(addKeysFn(nor.connect(stranger), 0n, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE)).to.be.revertedWith(
        "APP_AUTH_FAILED",
      );

      await expect(
        addKeysFn(nor.connect(nodeOperatorsManager), 0n, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("APP_AUTH_FAILED");

      await expect(addKeysFn(nor.connect(limitsManager), 0n, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE)).to.be.revertedWith(
        "APP_AUTH_FAILED",
      );

      await expect(
        addKeysFn(nor.connect(firstNOManager), secondNodeOperatorId, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("APP_AUTH_FAILED");

      await expect(
        addKeysFn(nor.connect(secondNOManager), firstNodeOperatorId, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("APP_AUTH_FAILED");
    });

    it("Reverts if zero keys passed", async () => {
      await expect(
        addKeysFn(nor.connect(signingKeysManager), 0n, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("OUT_OF_RANGE");

      await expect(
        addKeysFn(nor.connect(firstNOManager), firstNodeOperatorId, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("OUT_OF_RANGE");

      await expect(
        addKeysFn(nor.connect(secondNOManager), secondNodeOperatorId, 0n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("OUT_OF_RANGE");
    });

    it("Reverts if keys length mismatch", async () => {
      await expect(
        addKeysFn(nor.connect(signingKeysManager), 0n, 2n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("LENGTH_MISMATCH");

      const keysCount = 3;
      const [publicKeys, signatures] = firstNOKeys.slice(0, keysCount);

      await expect(
        addKeysFn(nor.connect(signingKeysManager), 0n, keysCount + 1, publicKeys, signatures),
      ).to.be.revertedWith("LENGTH_MISMATCH");

      await expect(
        addKeysFn(nor.connect(signingKeysManager), 0n, keysCount - 1, publicKeys, signatures),
      ).to.be.revertedWith("LENGTH_MISMATCH");
    });

    it("Reverts if too many keys in total across node operators", async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[thirdNodeOperatorId])).to.be.equal(
        thirdNodeOperatorId,
      );

      const keysCount = 1;
      const [publicKeys, signatures] = thirdNOKeys.slice(0, keysCount);

      await expect(
        addKeysFn(nor.connect(signingKeysManager), thirdNodeOperatorId, keysCount, publicKeys, signatures),
      ).to.be.revertedWith("PACKED_OVERFLOW");
    });

    it("Reverts if too many keys passed for a single node operator", async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[thirdNodeOperatorId])).to.be.equal(
        thirdNodeOperatorId,
      );

      const keysCount = UINT64_MAX - NODE_OPERATORS[thirdNodeOperatorId].totalSigningKeysCount + 1n;
      const [publicKeys, signatures] = thirdNOKeys.slice(0, Number(keysCount));

      await expect(
        addKeysFn(nor.connect(signingKeysManager), thirdNodeOperatorId, keysCount, publicKeys, signatures),
      ).to.be.revertedWith("OUT_OF_RANGE");
    });

    it("Reverts if empty key passed", async () => {
      await expect(
        addKeysFn(nor.connect(signingKeysManager), 0n, 1n, EMPTY_PUBLIC_KEY, EMPTY_SIGNATURE),
      ).to.be.revertedWith("EMPTY_KEY");
    });

    it("Appends new unvetted yet keys to a node operator", async () => {
      let keysCount = 5n;
      let [publicKeys, signatures] = firstNOKeys.slice(0, Number(keysCount));

      const nonce = await nor.getNonce();

      await expect(addKeysFn(nor.connect(firstNOManager), firstNodeOperatorId, keysCount, publicKeys, signatures))
        .to.emit(nor, "TotalSigningKeysCountChanged")
        .withArgs(firstNodeOperatorId, NODE_OPERATORS[firstNodeOperatorId].totalSigningKeysCount + keysCount)
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n);

      keysCount = 3n;
      [publicKeys, signatures] = secondNOKeys.slice(0, Number(keysCount));

      await expect(addKeysFn(nor.connect(signingKeysManager), secondNodeOperatorId, keysCount, publicKeys, signatures))
        .to.emit(nor, "TotalSigningKeysCountChanged")
        .withArgs(secondNodeOperatorId, NODE_OPERATORS[secondNodeOperatorId].totalSigningKeysCount + keysCount)
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 2n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 2n);
    });
  }

  context("addSigningKeys", () => {
    const func = async (
      nor_instance: NodeOperatorsRegistry__MockForFlow,
      _nodeOperatorId: BigNumberish,
      _keysCount: BigNumberish,
      _publicKeys: BytesLike,
      _signatures: BytesLike,
    ) => {
      return nor_instance.addSigningKeys(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    };

    addSigningKeysCases(func);
  });

  context("addSigningKeysOperatorBH", () => {
    const funcBH = async (
      nor_instance: NodeOperatorsRegistry__MockForFlow,
      _nodeOperatorId: BigNumberish,
      _keysCount: BigNumberish,
      _publicKeys: BytesLike,
      _signatures: BytesLike,
    ) => {
      return nor_instance.addSigningKeysOperatorBH(_nodeOperatorId, _keysCount, _publicKeys, _signatures);
    };

    addSigningKeysCases(funcBH);
  });

  context("removeSigningKey", () => {});

  context("removeSigningKeys", () => {});

  context("removeSigningKeyOperatorBH", () => {});

  context("removeSigningKeysOperatorBH", () => {});

  context("getTotalSigningKeyCount", () => {});

  context("getUnusedSigningKeyCount", () => {});

  context("getSigningKey", () => {});

  context("getSigningKeys", () => {});
});
