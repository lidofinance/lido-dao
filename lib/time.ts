import { ethers } from "hardhat";

import { time } from "@nomicfoundation/hardhat-network-helpers";

import { SECONDS_PER_SLOT } from "./constants";

export function minutes(number: bigint): bigint {
  return number * 60n;
}

export function hours(number: bigint): bigint {
  return number * minutes(60n);
}

export function days(number: bigint): bigint {
  return number * hours(24n);
}

export async function getNextBlockTimestamp() {
  const latestBlockTimestamp = BigInt(await time.latest());
  const nextBlockTimestamp = latestBlockTimestamp + SECONDS_PER_SLOT;
  await time.setNextBlockTimestamp(nextBlockTimestamp);
  return nextBlockTimestamp;
}

export async function advanceChainTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}
