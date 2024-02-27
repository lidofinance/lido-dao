import { ethers, network } from "hardhat";

import { EIP712StETH__factory, StethPermitMockWithEip712Initialization__factory } from "typechain-types";

import { ether } from "lib/units";

import { testERC2612Compliance } from "../common/erc2612.test";

testERC2612Compliance({
  tokenName: "stETH",
  deploy: async () => {
    const [deployer, owner] = await ethers.getSigners();

    const value = ether("1.0");
    const steth = await new StethPermitMockWithEip712Initialization__factory(deployer).deploy(owner, { value });

    const eip712helper = await new EIP712StETH__factory(deployer).deploy(steth);
    await steth.initializeEIP712StETH(eip712helper);

    return {
      token: steth,
      domain: {
        name: "Liquid staked Ether 2.0",
        version: "2",
        chainId: network.config.chainId!,
        verifyingContract: await steth.getAddress(),
      },
      owner,
    };
  },
});
