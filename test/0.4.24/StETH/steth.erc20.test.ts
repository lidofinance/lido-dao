import { testERC20Compliance } from "../../common/erc20.test";
import { ethers } from "hardhat";
import { StethERC20Mock__factory } from "typechain-types";
import { ether } from "lib/units";

testERC20Compliance({
  tokenName: "stETH",
  deploy,
});

testERC20Compliance({
  tokenName: "stETH (after positive rebase)",
  deploy: () => deploy(105n), // +5%
});

testERC20Compliance({
  tokenName: "stETH (after negative rebase)",
  deploy: () => deploy(95n), // -5%
});

async function deploy(rebaseFactor: bigint = 100n) {
  const signers = await ethers.getSigners();
  const holder = signers[signers.length - 1];
  const holderBalance = ether("10.0");

  const factory = new StethERC20Mock__factory(holder);
  const steth = await factory.deploy(holder, { value: holderBalance });

  const rebasedTotalSupply = (holderBalance * rebaseFactor) / 100n;
  await steth.setTotalPooledEther(rebasedTotalSupply);

  return {
    token: steth,
    name: "Liquid staked Ether 2.0",
    symbol: "stETH",
    decimals: 18n,
    totalSupply: rebasedTotalSupply,
    holder,
  };
}
