import { ethers } from "hardhat";

import { testERC721Compliance } from "../../common/erc721.test";

import deployWithdrawalQueue from "./deploy";

testERC721Compliance({
  tokenName: "WithdrawalQueue NFT",
  deploy: async () => {
    const signers = await ethers.getSigners();
    const owner = signers[signers.length - 1];

    const deployed = await deployWithdrawalQueue({ owner });

    return {
      token: deployed.token,
      name: deployed.name,
      symbol: deployed.symbol,
      holder: deployed.owner,
      holderTokenId: deployed.ownerTokenId,
    };
  },
});
