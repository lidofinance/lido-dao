import { DiscoveryConfig, DiscoveryService } from "./discovery";
import { AccountingOracleService, PauseService, SimpleDVTService } from "./services";
import { Contracts, LidoProtocol } from "./types";

export class Protocol {
  public readonly pauseService: PauseService;
  public readonly accountingOracleService: AccountingOracleService;
  public readonly simpleDVTService: SimpleDVTService;

  constructor(
    public readonly contracts: Contracts,
    public readonly discoveryService: DiscoveryService,
  ) {
    this.contracts = contracts;
    this.discoveryService = discoveryService;

    this.pauseService = new PauseService(this);
    this.accountingOracleService = new AccountingOracleService(this);
    this.simpleDVTService = new SimpleDVTService(this);
  }
}

export async function getLidoProtocol(): Promise<LidoProtocol> {
  const discoveryConfig = new DiscoveryConfig();
  const discoveryService = new DiscoveryService(discoveryConfig);
  const contracts = await discoveryService.discover();

  return new Protocol(contracts, discoveryService);
}
