import hre from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  AccountingOracle,
  Burner,
  DepositSecurityModule,
  HashConsensus,
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
  WithdrawalVault,
} from "typechain-types";

import { batch, ether, impersonate, log } from "lib";

import { BaseContract, BaseContracts, Contracts, LoadedContract } from "../types";

import { DiscoveryConfig } from "./DiscoveryConfig";

export class DiscoveryService {
  protected contracts: Contracts | null = null;

  constructor(protected readonly discoveryConfig: DiscoveryConfig) {}

  async locator(): Promise<LidoLocator> {
    return await hre.ethers.getContractAt("LidoLocator", this.discoveryConfig.locatorAddress);
  }

  async agentSigner(balance = ether("100")): Promise<HardhatEthersSigner> {
    const signer = await hre.ethers.getSigner(this.discoveryConfig.agentAddress);
    return impersonate(signer.address, balance);
  }

  async votingSigner(balance = ether("100")): Promise<HardhatEthersSigner> {
    const signer = await hre.ethers.getSigner(this.discoveryConfig.votingAddress);
    return impersonate(signer.address, balance);
  }

  async discover() {
    const locator = await this.locator();

    if (this.contracts) {
      log("Contracts are already discovered");
      return this.contracts;
    }

    const baseContracts = (await batch({
      accountingOracle: this.loadContract<AccountingOracle>("AccountingOracle", await locator.accountingOracle()),
      depositSecurityModule: this.loadContract<DepositSecurityModule>(
        "DepositSecurityModule",
        await locator.depositSecurityModule(),
      ),
      elRewardsVault: this.loadContract<LidoExecutionLayerRewardsVault>(
        "LidoExecutionLayerRewardsVault",
        await locator.elRewardsVault(),
      ),
      legacyOracle: this.loadContract<LegacyOracle>("LegacyOracle", await locator.legacyOracle()),
      lido: this.loadContract<Lido>("Lido", await locator.lido()),
      oracleReportSanityChecker: this.loadContract<OracleReportSanityChecker>(
        "OracleReportSanityChecker",
        await locator.oracleReportSanityChecker(),
      ),
      burner: this.loadContract<Burner>("Burner", await locator.burner()),
      stakingRouter: this.loadContract<StakingRouter>("StakingRouter", await locator.stakingRouter()),
      validatorsExitBusOracle: this.loadContract<ValidatorsExitBusOracle>(
        "ValidatorsExitBusOracle",
        await locator.validatorsExitBusOracle(),
      ),
      withdrawalQueue: this.loadContract<WithdrawalQueueERC721>(
        "WithdrawalQueueERC721",
        await locator.withdrawalQueue(),
      ),
      withdrawalVault: this.loadContract<WithdrawalVault>("WithdrawalVault", await locator.withdrawalVault()),
      oracleDaemonConfig: this.loadContract<OracleDaemonConfig>(
        "OracleDaemonConfig",
        await locator.oracleDaemonConfig(),
      ),
      postTokenRebaseReceiverAddress: locator.postTokenRebaseReceiver(),
      treasuryAddress: locator.treasury(),
    })) as BaseContracts;

    // Extend contracts with auto-discoverable contracts
    this.contracts = {
      ...baseContracts,
      ...(await batch({
        ...(await this.loadHashConsensus(baseContracts.accountingOracle)),
        ...(await this.loadStakingModules(baseContracts.stakingRouter)),
      })),
    } as Contracts;

    log.debug("Discovered contracts", {
      "Accounting Oracle": this.contracts.accountingOracle.address,
      "Deposit Security Module": this.contracts.depositSecurityModule.address,
      "EL Rewards Vault": this.contracts.elRewardsVault.address,
      "Legacy Oracle": this.contracts.legacyOracle.address,
      Lido: this.contracts.lido.address,
      "Oracle Report Sanity Checker": this.contracts.oracleReportSanityChecker.address,
      Burner: this.contracts.burner.address,
      "Staking Router": this.contracts.stakingRouter.address,
      "Validators Exit Bus Oracle": this.contracts.validatorsExitBusOracle.address,
      "Withdrawal Queue": this.contracts.withdrawalQueue.address,
      "Withdrawal Vault": this.contracts.withdrawalVault.address,
      "Oracle Daemon Config": this.contracts.oracleDaemonConfig.address,
      "Post Token Rebase Receiver": this.contracts.postTokenRebaseReceiverAddress,
      Treasury: this.contracts.treasuryAddress,
      "Hash Consensus": this.contracts.hashConsensus.address,
      "Node Operators Registry": this.contracts.nodeOperatorsRegistry.address,
      "Simple DVT": this.contracts.simpleDVT.address,
    });

    return this.contracts;
  }

  private async loadContract<ContractType extends BaseContract>(name: string, address: string) {
    const contract = (await hre.ethers.getContractAt(name, address)) as unknown as LoadedContract<ContractType>;

    contract.address = address;

    return contract;
  }

  private async loadHashConsensus(accountingOracle: LoadedContract<AccountingOracle>) {
    const hashConsensusAddress = await accountingOracle.getConsensusContract();
    return {
      hashConsensus: this.loadContract<HashConsensus>("HashConsensus", hashConsensusAddress),
    };
  }

  private async loadStakingModules(stakingRouter: LoadedContract<StakingRouter>) {
    const modules = await stakingRouter.getStakingModules();
    return {
      nodeOperatorsRegistry: this.loadContract<NodeOperatorsRegistry>(
        "NodeOperatorsRegistry",
        modules[0].stakingModuleAddress,
      ),
      simpleDVT: this.loadContract<NodeOperatorsRegistry>("NodeOperatorsRegistry", modules[1].stakingModuleAddress),
    };
  }
}
