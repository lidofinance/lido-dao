import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { ether, impersonate } from "lib";

import { DiscoveryConfig, DiscoveryService } from "./discovery";
import { AccountingOracleService, PauseService, SimpleDVTService } from "./services";
import { Contracts, LidoProtocol, Signers } from "./types";

export class Protocol {
  public readonly contracts: Contracts;
  private readonly signers: Signers;

  public readonly pause: PauseService;
  public readonly accounting: AccountingOracleService;
  public readonly sdvt: SimpleDVTService;

  constructor(
    contracts: Contracts,
    signers: Signers
  ) {
    this.contracts = contracts;
    this.signers = signers;

    this.pause = new PauseService(this);
    this.accounting = new AccountingOracleService(this);
    this.sdvt = new SimpleDVTService(this);
  }

  /**
   * Get signer by name or address.
   */
  async getSigner(signer: keyof Signers | string, balance = ether("100")): Promise<HardhatEthersSigner> {
    // @ts-expect-error TS7053
    const signerAddress = this.signers[signer] ?? signer;
    return impersonate(signerAddress, balance);
  }
}

export async function getLidoProtocol(): Promise<LidoProtocol> {
  const discoveryConfig = new DiscoveryConfig();
  const discoveryService = new DiscoveryService(discoveryConfig);
  const { contracts, signers } = await discoveryService.discover();

  return new Protocol(contracts, signers);
}
