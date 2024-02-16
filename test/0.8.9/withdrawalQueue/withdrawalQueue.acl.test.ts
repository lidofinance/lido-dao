import { expect } from "chai";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { WithdrawalQueueERC721 } from "typechain-types";

import {
  DEFAULT_ADMIN_ROLE,
  deployWithdrawalQueue,
  ERC165_INTERFACE_ID,
  INVALID_INTERFACE_ID,
  OZ_ACCESS_CONTROL_ENUMERABLE_INTERFACE_ID,
  OZ_ACCESS_CONTROL_INTERFACE_ID,
  randomAddress,
  Snapshot,
} from "lib";

describe(`WithdrawalQueueERC721:ACL`, () => {
  let contract: WithdrawalQueueERC721;

  let queueAdmin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let resumer: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let finalizer: HardhatEthersSigner;

  let originalState: string;
  let PAUSE_ROLE: string;
  let RESUME_ROLE: string;

  before(async () => {
    [queueAdmin, stranger, pauser, resumer, oracle, finalizer] = await ethers.getSigners();

    const deployed = await deployWithdrawalQueue({
      queueAdmin: queueAdmin,
      queuePauser: pauser,
      queueResumer: resumer,
      queueOracle: oracle,
      queueFinalizer: finalizer,
    });

    contract = deployed.queue;

    PAUSE_ROLE = await contract.PAUSE_ROLE();
    RESUME_ROLE = await contract.RESUME_ROLE();
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("supportsInterface", () => {
    it("should return true for ERC165_INTERFACE_ID", async () => {
      expect(await contract.supportsInterface(ERC165_INTERFACE_ID)).to.be.true;
    });

    it("should return true for AccessControl", async () => {
      expect(await contract.supportsInterface(OZ_ACCESS_CONTROL_INTERFACE_ID)).to.be.true;
    });

    it("Returns true for AccessControlEnumerable", async () => {
      expect(await contract.supportsInterface(OZ_ACCESS_CONTROL_ENUMERABLE_INTERFACE_ID)).to.equal(true);
    });

    it("Returns false for invalid interface", async () => {
      expect(await contract.supportsInterface(INVALID_INTERFACE_ID)).to.equal(false);
    });
  });

  context("hasRole", () => {
    it("Returns false for a role that has not been granted", async () => {
      expect(await contract.hasRole(DEFAULT_ADMIN_ROLE, randomAddress())).to.be.false;
    });

    it("Returns true for a role that has been granted", async () => {
      expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), queueAdmin)).to.be.true;
      expect(await contract.hasRole(await contract.PAUSE_ROLE(), pauser)).to.be.true;
      expect(await contract.hasRole(await contract.RESUME_ROLE(), resumer)).to.be.true;
      expect(await contract.hasRole(await contract.ORACLE_ROLE(), oracle)).to.be.true;
      expect(await contract.hasRole(await contract.FINALIZE_ROLE(), finalizer)).to.be.true;
      expect(await contract.hasRole(await contract.MANAGE_TOKEN_URI_ROLE(), queueAdmin)).to.be.true;
    });
  });

  context("getRoleAdmin", () => {
    it("Returns the admin role as admin role for itself", async () => {
      expect(await contract.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
    });

    it("Returns the default admin as other roles admin", async () => {
      expect(await contract.getRoleAdmin(PAUSE_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
    });
  });

  context("grantRole", () => {
    it("Reverts if caller is not admin", async () => {
      await expect(
        contract.connect(pauser).grantRole(PAUSE_ROLE, pauser.address),
      ).to.be.revertedWithOZAccessControlError(pauser.address, DEFAULT_ADMIN_ROLE);
    });

    it("Does nothing if role is already granted", async () => {
      await expect(contract.grantRole(PAUSE_ROLE, pauser.address)).not.to.emit(contract, "RoleGranted");
    });

    it("Grants the role", async () => {
      await expect(await contract.grantRole(PAUSE_ROLE, stranger))
        .to.emit(contract, "RoleGranted")
        .withArgs(PAUSE_ROLE, stranger.address, queueAdmin.address);

      expect(await contract.hasRole(PAUSE_ROLE, stranger.address)).to.be.true;
    });
  });

  context("revokeRole", () => {
    it("Reverts if caller is not admin", async () => {
      await expect(
        contract.connect(pauser).revokeRole(PAUSE_ROLE, pauser.address),
      ).to.be.revertedWithOZAccessControlError(pauser.address, DEFAULT_ADMIN_ROLE);

      expect(await contract.hasRole(PAUSE_ROLE, pauser.address)).to.be.true;
    });

    it("Does nothing if role is already revoked", async () => {
      await expect(contract.revokeRole(RESUME_ROLE, pauser.address)).not.to.emit(contract, "RoleRevoked");

      expect(await contract.hasRole(RESUME_ROLE, pauser.address)).to.be.false;
    });

    it("Revokes the role", async () => {
      await expect(await contract.revokeRole(PAUSE_ROLE, pauser.address))
        .to.emit(contract, "RoleRevoked")
        .withArgs(PAUSE_ROLE, pauser.address, queueAdmin.address);

      expect(await contract.hasRole(PAUSE_ROLE, pauser.address)).to.be.false;
    });
  });

  context("renounceRole", () => {
    it("Reverts if renounce not for self", async () => {
      await expect(contract.renounceRole(PAUSE_ROLE, pauser.address)).to.be.revertedWith(
        "AccessControl: can only renounce roles for self",
      );

      expect(await contract.hasRole(PAUSE_ROLE, pauser.address)).to.be.true;
    });

    it("Does nothing if role is not assigned", async () => {
      await expect(contract.connect(resumer).renounceRole(PAUSE_ROLE, resumer.address)).not.to.emit(
        contract,
        "RoleRevoked",
      );

      expect(await contract.hasRole(PAUSE_ROLE, resumer.address)).to.be.false;
    });

    it("Revokes the role", async () => {
      await expect(await contract.connect(resumer).renounceRole(RESUME_ROLE, resumer.address))
        .to.emit(contract, "RoleRevoked")
        .withArgs(RESUME_ROLE, resumer.address, resumer.address);

      expect(await contract.hasRole(RESUME_ROLE, resumer.address)).to.be.false;
    });
  });

  context("getRoleMemberCount", () => {
    it("Returns the number of role members", async () => {
      expect(await contract.getRoleMemberCount(PAUSE_ROLE)).to.equal(1);
    });
  });

  context("getRoleMember", () => {
    it("Returns the address of the role member", async () => {
      expect(await contract.getRoleMember(PAUSE_ROLE, 0)).to.be.equal(pauser.address);
    });
  });
});
