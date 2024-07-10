import hre from "hardhat";

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
  LidoLocator,
  NodeOperatorsRegistry,
  OracleDaemonConfig,
  OracleReportSanityChecker,
  StakingRouter,
  ValidatorsExitBusOracle,
  WithdrawalQueueERC721,
  WithdrawalVault
} from "typechain-types";

import { batch, log } from "lib";

import { BaseContract, BaseContracts, Contracts, LoadedContract, Signers } from "../types";

import { DiscoveryConfig } from "./DiscoveryConfig";

export class DiscoveryService {
  protected contracts: Contracts | null = null;
  protected signers: Signers | null = null;

  constructor(protected readonly discoveryConfig: DiscoveryConfig) {
  }

  async locator(): Promise<LidoLocator> {
    return await hre.ethers.getContractAt("LidoLocator", this.discoveryConfig.locatorAddress);
  }

  async discover() {
    const locator = await this.locator();

    if (!this.contracts) {
      this.contracts = await this.discoverContracts(locator);
    }

    if (!this.signers) {
      this.signers = await this.discoverSigners();
    }

    return {
      contracts: this.contracts,
      signers: this.signers
    };
  }

  private async discoverContracts(locator: LidoLocator) {
    const baseContracts = (await batch({
      accountingOracle: this.loadContract<AccountingOracle>("AccountingOracle", await locator.accountingOracle()),
      depositSecurityModule: this.loadContract<DepositSecurityModule>(
        "DepositSecurityModule",
        await locator.depositSecurityModule()
      ),
      elRewardsVault: this.loadContract<LidoExecutionLayerRewardsVault>(
        "LidoExecutionLayerRewardsVault",
        await locator.elRewardsVault()
      ),
      legacyOracle: this.loadContract<LegacyOracle>("LegacyOracle", await locator.legacyOracle()),
      lido: this.loadContract<Lido>("Lido", await locator.lido()),
      oracleReportSanityChecker: this.loadContract<OracleReportSanityChecker>(
        "OracleReportSanityChecker",
        await locator.oracleReportSanityChecker()
      ),
      burner: this.loadContract<Burner>("Burner", await locator.burner()),
      stakingRouter: this.loadContract<StakingRouter>("StakingRouter", await locator.stakingRouter()),
      validatorsExitBusOracle: this.loadContract<ValidatorsExitBusOracle>(
        "ValidatorsExitBusOracle",
        await locator.validatorsExitBusOracle()
      ),
      withdrawalQueue: this.loadContract<WithdrawalQueueERC721>(
        "WithdrawalQueueERC721",
        await locator.withdrawalQueue()
      ),
      withdrawalVault: this.loadContract<WithdrawalVault>("WithdrawalVault", await locator.withdrawalVault()),
      oracleDaemonConfig: this.loadContract<OracleDaemonConfig>(
        "OracleDaemonConfig",
        await locator.oracleDaemonConfig()
      ),
      postTokenRebaseReceiverAddress: locator.postTokenRebaseReceiver(),
      treasuryAddress: locator.treasury()
    })) as BaseContracts;

    // Extend contracts with auto-discoverable contracts
    const contracts = {
      ...baseContracts,
      ...(await batch({
        ...(await this.loadAragonContracts(baseContracts.lido)),
        ...(await this.loadHashConsensus(baseContracts.accountingOracle)),
        ...(await this.loadStakingModules(baseContracts.stakingRouter))
      }))
    } as Contracts;

    log.debug("Discovered contracts", {
      "Accounting Oracle": contracts.accountingOracle.address,
      "Deposit Security Module": contracts.depositSecurityModule.address,
      "EL Rewards Vault": contracts.elRewardsVault.address,
      "Legacy Oracle": contracts.legacyOracle.address,
      "Lido": contracts.lido.address,
      "Oracle Report Sanity Checker": contracts.oracleReportSanityChecker.address,
      "Burner": contracts.burner.address,
      "Staking Router": contracts.stakingRouter.address,
      "Validators Exit Bus Oracle": contracts.validatorsExitBusOracle.address,
      "Withdrawal Queue": contracts.withdrawalQueue.address,
      "Withdrawal Vault": contracts.withdrawalVault.address,
      "Oracle Daemon Config": contracts.oracleDaemonConfig.address,
      "Post Token Rebase Receiver": contracts.postTokenRebaseReceiverAddress,
      "Treasury": contracts.treasuryAddress,
      "Hash Consensus": contracts.hashConsensus.address,
      "Node Operators Registry": contracts.nor.address,
      "Simple DVT": contracts.sdvt.address
    });

    return contracts;
  }

  private async discoverSigners() {
    return {
      agent: this.discoveryConfig.agentAddress,
      voting: this.discoveryConfig.votingAddress,
      easyTrackExecutor: this.discoveryConfig.easyTrackExecutorAddress
    };
  }

  private async loadContract<ContractType extends BaseContract>(name: string, address: string) {
    const contract = (await hre.ethers.getContractAt(name, address)) as unknown as LoadedContract<ContractType>;

    contract.address = address;

    return contract;
  }

  private async loadAragonContracts(lido: LoadedContract<Lido>) {
    const kernelAddress = await lido.kernel();
    const kernel = await this.loadContract<Kernel>("Kernel", kernelAddress);

    return {
      kernel: new Promise((resolve) => resolve(kernel)), // hack to avoid batch TS error
      acl: this.loadContract<ACL>("ACL", await kernel.acl())
    };
  }

  private async loadHashConsensus(accountingOracle: LoadedContract<AccountingOracle>) {
    const hashConsensusAddress = await accountingOracle.getConsensusContract();
    return {
      hashConsensus: this.loadContract<HashConsensus>("HashConsensus", hashConsensusAddress)
    };
  }

  private async loadStakingModules(stakingRouter: LoadedContract<StakingRouter>) {
    const [nor, sdvt] = await stakingRouter.getStakingModules();
    return {
      nor: this.loadContract<NodeOperatorsRegistry>("NodeOperatorsRegistry", nor.stakingModuleAddress),
      sdvt: this.loadContract<NodeOperatorsRegistry>("NodeOperatorsRegistry", sdvt.stakingModuleAddress)
    };
  }
}
