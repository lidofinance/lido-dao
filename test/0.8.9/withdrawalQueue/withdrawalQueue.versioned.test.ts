import { ethers } from "hardhat";

import { WithdrawalQueueERC721__factory } from "typechain-types";

import { randomAddress } from "lib";

import { testVersionedCompliance } from "../../common/versioned.test";

import deployMinimumWithdrawalQueue from "./deploy";

testVersionedCompliance({
  name: "WithdrawalQueue Versioned",
  deploy: async () => {
    const signers = await ethers.getSigners();
    const owner = signers[signers.length - 1];
    const deployed = await deployMinimumWithdrawalQueue({ owner });
    return deployed.token;
  },
  updates: [
    {
      call: WithdrawalQueueERC721__factory.createInterface().encodeFunctionData("initialize", [randomAddress()]),
      version: 1n,
    },
  ],
});
