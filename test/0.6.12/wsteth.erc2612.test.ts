import { ethers } from "hardhat";

import { StethMinimalMockWithTotalPooledEther__factory, WstETH__factory } from "typechain-types";

import { ether } from "lib/units";

import { testERC2612Compliance } from "../common/erc2612.test";

testERC2612Compliance({
  tokenName: "wstETH",
  deploy: async () => {
    const signers = await ethers.getSigners();
    const [deployer, holder] = signers;
    const totalSupply = ether("10.0");

    const stethFactory = new StethMinimalMockWithTotalPooledEther__factory(deployer);
    const steth = await stethFactory.deploy(holder, { value: totalSupply });

    const wstethFactory = new WstETH__factory(deployer);
    const wsteth = await wstethFactory.deploy(await steth.getAddress());

    await steth.connect(holder).approve(await wsteth.getAddress(), totalSupply);
    await wsteth.connect(holder).wrap(totalSupply);

    return {
      token: wsteth,
      name: "Wrapped liquid staked Ether 2.0",
      version: "1",
    };
  },
});
