import { parseUnits } from "ethers";
import { testERC20Compliance } from "../common/erc20.test";
import { ethers } from "hardhat";

testERC20Compliance({
  tokenName: "stETH",
  deploy: async () => {
    const initialSupply = parseUnits("1.0", "ether");
    const userBalance = parseUnits("10.0", "ether");
    const totalSupply = initialSupply + userBalance;

    const steth = await ethers.deployContract("StETHMock", { value: initialSupply });

    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    await steth.mintSteth(holder, { value: userBalance });

    return {
      token: steth,
      name: "Liquid staked Ether 2.0",
      symbol: "stETH",
      decimals: 18n,
      totalSupply,
      holder,
    };
  },
});

testERC20Compliance({
  tokenName: "stETH (after positive rebase)",
  deploy: async () => {
    const initialSupply = parseUnits("1.0", "ether");
    const userBalance = parseUnits("10.0", "ether");
    let totalSupply = initialSupply + userBalance;

    const steth = await ethers.deployContract("StETHMock", { value: initialSupply });

    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    await steth.mintSteth(holder, { value: userBalance });

    // simulating a positive 5% rebase
    totalSupply = (totalSupply * 105n) / 100n;
    await steth.setTotalPooledEther(totalSupply);

    return {
      token: steth,
      name: "Liquid staked Ether 2.0",
      symbol: "stETH",
      decimals: 18n,
      totalSupply,
      holder,
    };
  },
});

testERC20Compliance({
  tokenName: "stETH (after negative rebase)",
  deploy: async () => {
    const initialSupply = parseUnits("1.0", "ether");
    const userBalance = parseUnits("10.0", "ether");
    let totalSupply = initialSupply + userBalance;

    const steth = await ethers.deployContract("StETHMock", { value: initialSupply });

    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    await steth.mintSteth(holder, { value: userBalance });

    // simulating a negative 5% rebase
    totalSupply = (totalSupply * 95n) / 100n;
    await steth.setTotalPooledEther(totalSupply);

    return {
      token: steth,
      name: "Liquid staked Ether 2.0",
      symbol: "stETH",
      decimals: 18n,
      totalSupply,
      holder,
    };
  },
});
