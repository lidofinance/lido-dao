import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ExclusiveSuiteFunction, PendingSuiteFunction, describe } from "mocha";
import { MAX_UINT256 } from "lib";
import { OssifiableProxy, Versioned, Versioned__factory } from "typechain-types";

interface VersionUpdate {
  call: string;
  version: bigint;
}

interface VersionedTarget {
  name: string;
  deploy: () => Promise<Versioned>;
  updates: VersionUpdate[];
  suiteFunction?: ExclusiveSuiteFunction | PendingSuiteFunction;
}

/**
 * @function testVersionedCompliance
 * @description This function provides a black-box test suite for verifying
 * the compliance of a contract to Versioned
 *
 * @param {object} target.name name of the token to use in the suite description
 * @param {object} target.deploy async function that returns the instance of the contract
 * @param {VersionUpdate[]} target.updates array of encoded function calls that update the contract version
 * Provide all functions calls that update the contract version to the expected versions.
 * This is a workaround that makes reusable Versioned tests possible because we cannot otherwise
 * predict how the derived contracts are used.
 * @param {object} target.suiteFunction function that runs the suite, a temporary workaround for running
 * the suite exclusively or skipping the suite; see the todo below
 *
 * @todo rewrite the function to support the same interface as `describe`, i.e.
 * instead of passing `suiteFunction`, we should be able to call the function like:
 * testVersionedCompliance.only(target)
 * testVersionedCompliance.skip(target)
 */
export default function testVersionedCompliance({ name, deploy, updates, suiteFunction = describe }: VersionedTarget) {
  suiteFunction(`${name} Versioned Compliance`, function () {
    let admin: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let impl: Versioned;
    let proxy: OssifiableProxy;
    let versioned: Versioned;

    const petrifiedVersion = MAX_UINT256;

    this.beforeEach(async function () {
      [admin, user] = await ethers.getSigners();

      impl = await deploy();
      proxy = await ethers.deployContract(
        "OssifiableProxy",
        [await impl.getAddress(), admin.address, new Uint8Array()],
        {
          from: admin,
        },
      );
      versioned = Versioned__factory.connect(await proxy.getAddress(), user);
    });

    context("constructor", function () {
      it("Petrifies the implementation", async function () {
        expect(await impl.getContractVersion()).to.equal(petrifiedVersion);
      });
    });

    context("getContractVersion", function () {
      it("Returns 0 as the initial contract version", async function () {
        expect(await versioned.getContractVersion()).to.equal(0n);
      });
    });

    context("setContractVersion", function () {
      for (const { call, version } of updates) {
        it("Updates the contract version on the proxy", async function () {
          await user.sendTransaction({
            to: await versioned.getAddress(),
            data: call,
          });

          expect(await versioned.getContractVersion()).to.equal(version);
          expect(await impl.getContractVersion()).to.equal(petrifiedVersion);
        });
      }
    });
  });
}
