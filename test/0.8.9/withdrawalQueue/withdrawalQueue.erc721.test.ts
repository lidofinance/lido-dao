import { ethers } from "hardhat";

import { ether } from "lib";

import { testERC721Compliance } from "../../common/erc721.test";

import deployWithdrawalQueue from "./deploy";

testERC721Compliance({
  tokenName: "WithdrawalQueue NFT",
  deploy: async () => {
    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    const initialStEth = ether("1.0");
    const holderStEth = ether("99.0");

    const deployed = await deployWithdrawalQueue({
      initialStEth,
      owner: holder,
      ownerStEth: holderStEth,
    });

    const { token, tokenAddress, stEth } = deployed;

    await stEth.connect(holder).approve(tokenAddress, holderStEth);
    await token.connect(holder).requestWithdrawals([holderStEth], holder);

    const holderTokenId = await token.getLastRequestId();

    return {
      token,
      name: deployed.name,
      symbol: deployed.symbol,
      holder,
      holderTokenId,
    };
  },
});
