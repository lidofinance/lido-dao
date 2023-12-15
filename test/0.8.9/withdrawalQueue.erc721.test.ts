import { ethers } from "hardhat";
import { testERC721Compliance } from "../common/erc721.test";
import { ether } from "../../lib";

testERC721Compliance({
  tokenName: "WithdrawalQueue NFT",
  deploy: async () => {
    const signers = await ethers.getSigners();
    const holder = signers[signers.length - 1];

    const initialTotalSupply = ether("1.0");
    const holderSteth = ether("99.0");

    const steth = await ethers.deployContract("StETHPermitMock", { value: initialTotalSupply });
    await steth.mintSteth(holder, { value: holderSteth });

    const stethAddress = await steth.getAddress();
    const wsteth = await ethers.deployContract("WstETHMock", [stethAddress]);

    const name = "Lido: Withdrawal Request NFT";
    const symbol = "unstETH";

    const token = await ethers.deployContract("WithdrawalQueueERC721", [await wsteth.getAddress(), name, symbol]);

    await steth.connect(holder).approve(await token.getAddress(), holderSteth);
    await token.connect(holder).requestWithdrawals([holderSteth], holder);

    const holderTokenId = await token.getLastRequestId();

    return {
      token,
      name,
      symbol,
      holder,
      holderTokenId,
    };
  },
  suiteFunction: describe.only,
});
