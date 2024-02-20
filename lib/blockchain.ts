import { HardhatEthersProvider } from "@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider";

export const getBlockTimestamp = async (provider: HardhatEthersProvider) => {
  const block = await provider.getBlock("latest");
  return block!.timestamp;
};
