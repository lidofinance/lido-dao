/**
 * Shared test helpers for TriggerableWithdrawalsBus and TriggerableWithdrawalsGateway tests.
 */
import { ethers } from "hardhat";

import { ONE_GWEI } from "lib";

/** Number of gwei in 1 ETH. */
export const GWEI_PER_ETH = ethers.WeiPerEther / ONE_GWEI;

/** Weight of a full withdrawal request against the gateway limit, in gwei (2048 ETH). */
export const FULL_WITHDRAWAL_WEIGHT_GWEI = 2048n * GWEI_PER_ETH;

/** Max amount of a single partial withdrawal request, in gwei. */
export const MAX_PARTIAL_WITHDRAWAL_AMOUNT_GWEI = FULL_WITHDRAWAL_WEIGHT_GWEI;

export type WithdrawalIntent = { amount: bigint; pubkey: string };

/** Deterministic 48-byte pubkey with non-zero bytes in both its 32-byte head and 16-byte tail. */
export const pubkeyAt = (i: number): string =>
  ethers.concat([ethers.id(`pubkey-head:${i}`), ethers.dataSlice(ethers.id(`pubkey-tail:${i}`), 0, 16)]);

/** Full withdrawal intent for the i-th test pubkey. */
export const fullWithdrawal = (i: number): WithdrawalIntent => ({ amount: 0n, pubkey: pubkeyAt(i) });

/** Partial withdrawal intent for the i-th test pubkey, `amount` in gwei. */
export const partialWithdrawal = (i: number, amount: bigint): WithdrawalIntent => ({ amount, pubkey: pubkeyAt(i) });

/** Converts `WithdrawalIntent[]` returned by a contract call into plain objects. */
export const toIntents = (result: { amount: bigint; pubkey: string }[]): WithdrawalIntent[] =>
  result.map(({ amount, pubkey }) => ({ amount, pubkey }));
