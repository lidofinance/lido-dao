import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ether } from "lib";

const QUEUE_NAME = "Lido: Withdrawal Request NFT";
const QUEUE_SYMBOL = "unstETH";

interface MinimumWithdrawalQueueDeploymentParams {
  owner: HardhatEthersSigner;
  initialStEth?: bigint;
  ownerStEth?: bigint;
  name?: string;
  symbol?: string;
}

export default async function deployWithdrawalQueue({
  owner,
  initialStEth = ether("1.0"),
  ownerStEth = ether("99.0"),
  name = QUEUE_NAME,
  symbol = QUEUE_SYMBOL,
}: MinimumWithdrawalQueueDeploymentParams) {
  const stEth = await ethers.deployContract("StETHPermitMock", {
    value: initialStEth,
  });

  await stEth.mintSteth(owner, { value: ownerStEth });

  const stEthAddress = await stEth.getAddress();
  const wstEth = await ethers.deployContract("WstETHMock", [stEthAddress]);

  const wstEthAddress = await wstEth.getAddress();

  const deployConfig = [wstEthAddress, name, symbol];
  const token = await ethers.deployContract("WithdrawalQueueERC721", deployConfig);

  const tokenAddress = await token.getAddress();

  return {
    // Deployed contract
    token,
    tokenAddress,
    name,
    symbol,
    owner,
    // Related contracts
    stEth,
    stEthAddress,
    wstEth,
    wstEthAddress,
  };
}
