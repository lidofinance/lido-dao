import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { deployLidoLocator } from "./locator";

const GWEI_PER_ETH = 10n ** 9n;

/** Default withdrawal limit of the gateway in tests: 10,000 ETH max, 32 ETH restored per frame of 1,000 seconds. */
export const DEFAULT_TWG_LIMIT = {
  maxWithdrawalLimitGwei: 10_000n * GWEI_PER_ETH,
  withdrawalLimitPerFrameGwei: 32n * GWEI_PER_ETH,
  frameDurationInSec: 1_000n,
};

/** Deploys TriggerableWithdrawalsGateway with a WithdrawalVault mock registered in a dummy locator. */
export async function deployTriggerableWithdrawalsGateway(admin: HardhatEthersSigner, limit = DEFAULT_TWG_LIMIT) {
  const withdrawalVault = await ethers.deployContract("WithdrawalVault__MockForTriggerableWithdrawalsGateway");
  const locator = await deployLidoLocator({ withdrawalVault: await withdrawalVault.getAddress() });

  const gateway = await ethers.deployContract("TriggerableWithdrawalsGateway", [
    admin.address,
    await locator.getAddress(),
    limit.maxWithdrawalLimitGwei,
    limit.withdrawalLimitPerFrameGwei,
    limit.frameDurationInSec,
  ]);

  return { gateway, withdrawalVault, locator };
}
