import { time } from "@nomicfoundation/hardhat-network-helpers";

import { BLOCK_TIME } from "./constants";

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
  const nextBlockTimestamp = latestBlockTimestamp + BLOCK_TIME;
  await time.setNextBlockTimestamp(nextBlockTimestamp);
  return nextBlockTimestamp;
}

export async function getNextBlockNumber() {
  const latestBlock = BigInt(await time.latestBlock());
  return latestBlock + 1n;
}

export async function getNextBlock() {
  const [timestamp, number] = await Promise.all([getNextBlockTimestamp(), getNextBlockNumber()]);

  return {
    timestamp,
    number,
  };
}
