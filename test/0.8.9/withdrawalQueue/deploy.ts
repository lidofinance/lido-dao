import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ether } from "lib";

const QUEUE_NAME = "Lido: Withdrawal Request NFT";
const QUEUE_SYMBOL = "unstETH";

interface MinimumWithdrawalQueueDeploymentParams {
  owner: HardhatEthersSigner;
  name?: string;
  symbol?: string;
}

export default async function deployWithdrawalQueue({
  owner,
  name = QUEUE_NAME,
  symbol = QUEUE_SYMBOL,
}: MinimumWithdrawalQueueDeploymentParams) {
  const initialTotalSupply = ether("1.0");
  const holderStEth = ether("99.0");

  const stEth = await ethers.deployContract("StETHPermitMock", {
    value: initialTotalSupply,
  });

  await stEth.mintSteth(owner, { value: holderStEth });

  const stEthAddress = await stEth.getAddress();
  const wstEth = await ethers.deployContract("WstETHMock", [stEthAddress]);

  const wstEthAddress = await wstEth.getAddress();

  const token = await ethers.deployContract("WithdrawalQueueERC721", [wstEthAddress, name, symbol]);
  const tokenAddress = await token.getAddress();

  await stEth.connect(owner).approve(tokenAddress, holderStEth);
  await token.connect(owner).requestWithdrawals([holderStEth], owner);

  const ownerTokenId = await token.getLastRequestId();

  return {
    token,
    tokenAddress,
    name,
    symbol,
    owner,
    ownerTokenId,
  };
}
