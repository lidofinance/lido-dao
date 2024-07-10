import { BaseContract as EthersBaseContract } from "ethers";

import {
  AccountingOracle,
  ACL,
  Burner,
  DepositSecurityModule,
  HashConsensus,
  Kernel,
  LegacyOracle,
  Lido,
  LidoExecutionLayerRewardsVault,
  NodeOperatorsRegistry,
  OracleDaemonConfig,
  OracleReportSanityChecker,
  StakingRouter,
  ValidatorsExitBusOracle,
  WithdrawalQueueERC721,
  WithdrawalVault
} from "typechain-types";

import { Protocol } from "./Protocol";

export type LoadedContract<T extends EthersBaseContract = EthersBaseContract> = T & {
  address: string;
};

export interface Contracts {
  // Contracts
  accountingOracle: LoadedContract<AccountingOracle>;
  depositSecurityModule: LoadedContract<DepositSecurityModule>;
  elRewardsVault: LoadedContract<LidoExecutionLayerRewardsVault>;
  legacyOracle: LoadedContract<LegacyOracle>;
  lido: LoadedContract<Lido>;
  oracleReportSanityChecker: LoadedContract<OracleReportSanityChecker>;
  burner: LoadedContract<Burner>;
  stakingRouter: LoadedContract<StakingRouter>;
  validatorsExitBusOracle: LoadedContract<ValidatorsExitBusOracle>;
  withdrawalQueue: LoadedContract<WithdrawalQueueERC721>;
  withdrawalVault: LoadedContract<WithdrawalVault>;
  oracleDaemonConfig: LoadedContract<OracleDaemonConfig>;
  // Addresses
  postTokenRebaseReceiverAddress: string;
  treasuryAddress: string;
  // Kernel
  kernel: LoadedContract<Kernel>;
  acl: LoadedContract<ACL>;
  // Dependencies
  hashConsensus: LoadedContract<HashConsensus>;
  // NOR & SDVT
  nor: LoadedContract<NodeOperatorsRegistry>;
  sdvt: LoadedContract<NodeOperatorsRegistry>;
}

export interface Signers {
  agent: string;
  voting: string;
  easyTrackExecutor: string;
}

export type BaseContract = EthersBaseContract;
export type BaseContracts = Omit<Contracts, "hashConsensus">;

export type LidoProtocol = Protocol;
