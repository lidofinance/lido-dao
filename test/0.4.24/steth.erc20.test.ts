import { parseUnits } from "ethers";
import { testERC20Compliance } from "../common/erc20.test";
import { ethers } from "hardhat";

testERC20Compliance({
  tokenName: "stETH",
  deploy: async () => {
    const initialSupply = parseUnits("1.0", "ether");
    const userBalance = parseUnits("10.0", "ether");
    const totalSupply = initialSupply + userBalance;

    const token = await ethers.deployContract("StETHMock", { value: initialSupply });

    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    await token.mintSteth(holder, { value: userBalance });

    return {
      token,
      name: "Liquid staked Ether 2.0",
      symbol: "stETH",
      decimals: 18n,
      totalSupply,
      holder,
    };
  },
});
