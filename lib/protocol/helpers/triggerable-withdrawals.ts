import { ContractTransactionResponse } from "ethers";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { readWithdrawalRequests } from "lib/eips/eip7002";

import { ProtocolContext } from "../types";

type RoleHolder = {
  hasRole(role: string, account: string): Promise<boolean>;
  connect(runner: HardhatEthersSigner): {
    grantRole(role: string, account: string): Promise<ContractTransactionResponse>;
  };
};

/** Pops every pending request from the EIP-7002 queue so a test reads only its own requests. */
export const drainWithdrawalRequestsQueue = async () => {
  while ((await readWithdrawalRequests()).length > 0) {
    /* empty */
  }
};

/** Grants `role` on `contract` to `account` from the Agent, the admin of the triggerable withdrawals contracts. */
export const ensureRoleFromAgent = async (
  ctx: ProtocolContext,
  contract: RoleHolder,
  role: string,
  account: HardhatEthersSigner | string,
) => {
  const address = typeof account === "string" ? account : account.address;
  if (await contract.hasRole(role, address)) return;

  const agent = await ctx.getSigner("agent");
  await (await contract.connect(agent).grantRole(role, address)).wait();
};

/**
 * Sets the gateway withdrawal limit, in gwei, with a long frame, so nothing is restored during a test and the
 * consumed quota can be checked exactly.
 */
export const setTriggerableWithdrawalsGatewayLimit = async (ctx: ProtocolContext, maxWithdrawalLimitGwei: bigint) => {
  const gateway = ctx.contracts.triggerableWithdrawalsGateway;
  const agent = await ctx.getSigner("agent");

  await ensureRoleFromAgent(ctx, gateway, await gateway.TW_EXIT_LIMIT_MANAGER_ROLE(), agent);
  await (await gateway.connect(agent).setWithdrawalLimit(maxWithdrawalLimitGwei, 1n, 365n * 24n * 3600n)).wait();
};
