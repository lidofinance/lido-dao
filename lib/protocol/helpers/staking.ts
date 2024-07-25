import { log } from "lib";

import { ProtocolContext } from "../types";

/**
 * Unpauses the staking contract.
 */
export const unpauseStaking = async (ctx: ProtocolContext) => {
  const { lido } = ctx.contracts;
  if (await lido.isStakingPaused()) {
    log.warning("Unpausing staking contract");
    const votingSigner = await ctx.getSigner("voting");
    await lido.connect(votingSigner).resume();
  }
};
