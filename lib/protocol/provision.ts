import {
  ensureHashConsensusInitialEpoch,
  ensureNOROperators,
  ensureOracleCommitteeMembers,
  unpauseStaking,
  unpauseWithdrawalQueue,
} from "./helpers";
import { ProtocolContext } from "./types";

/**
 * In order to make the protocol fully operational from scratch deploy, the additional steps are required:
 */
export const provision = async (ctx: ProtocolContext) => {

  await ensureHashConsensusInitialEpoch(ctx);

  await ensureOracleCommitteeMembers(ctx, 5n);

  // add oracle committee members to HashConsensus contracts for AccountingOracle and ValidatorsExitBusOracle: HashConsensus.addMember;
  // initialize initial epoch for HashConsensus contracts for AccountingOracle and ValidatorsExitBusOracle: HashConsensus.updateInitialEpoch;
  // add guardians to DepositSecurityModule: DepositSecurityModule.addGuardians;
  await unpauseStaking(ctx);

  await unpauseWithdrawalQueue(ctx);

  await ensureNOROperators(ctx, 3n, 5n);
  // add at least one Node Operator: NodeOperatorsRegistry.addNodeOperator;
  // add validator keys to the Node Operators: NodeOperatorsRegistry.addSigningKeys;
  // set staking limits for the Node Operators: NodeOperatorsRegistry.setNodeOperatorStakingLimit.
};
