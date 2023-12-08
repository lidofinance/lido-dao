import { ethers } from "hardhat";
import { testERC20Compliance } from "../common/erc20.test";
import { parseUnits } from "ethers";

testERC20Compliance({
  tokenName: "wstETH",
  deploy: async () => {
    const initialSupply = parseUnits("1.0", "ether");
    const userBalance = parseUnits("10.0", "ether");

    const steth = await ethers.deployContract("StETHMock", { value: initialSupply });

    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    await steth.mintSteth(holder, { value: userBalance });

    const wsteth = await ethers.deployContract("WstETHMock", [await steth.getAddress()]);

    await steth.connect(holder).approve(await wsteth.getAddress(), userBalance);
    await wsteth.connect(holder).wrap(userBalance);

    const totalSupply = userBalance;

    return {
      token: wsteth,
      name: "Wrapped liquid staked Ether 2.0",
      symbol: "wstETH",
      decimals: 18n,
      totalSupply,
      holder,
    };
  },
});
