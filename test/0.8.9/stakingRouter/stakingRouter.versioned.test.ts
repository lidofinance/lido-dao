import { ethers } from "hardhat";
import { randomAddress } from "lib";
import testVersionedCompliance from "../../common/versioned.test";
import { randomBytes } from "crypto";
import { StakingRouter__factory } from "typechain-types";

testVersionedCompliance({
  name: "StakingRouter",
  deploy: async () => {
    const depositContract = randomAddress();
    return ethers.deployContract("StakingRouter", [depositContract]);
  },
  updates: [
    {
      call: StakingRouter__factory.createInterface().encodeFunctionData("initialize", [
        randomAddress(),
        randomAddress(),
        randomBytes(32),
      ]),
      version: 1n,
    },
  ],
});
