import { DiscoveryConfig, DiscoveryService } from "./discovery";
import { AccountingOracleService, NodeOperatorsRegistryService,PauseService } from "./services";
import { Contracts, LidoProtocol } from "./types";

export class Protocol {
  public readonly pause: PauseService;
  public readonly accounting: AccountingOracleService;
  public readonly nor: NodeOperatorsRegistryService;
  public readonly sdvt: NodeOperatorsRegistryService;

  constructor(
    public readonly contracts: Contracts,
    public readonly discoveryService: DiscoveryService,
  ) {
    this.contracts = contracts;
    this.discoveryService = discoveryService;

    this.pause = new PauseService(this);
    this.accounting = new AccountingOracleService(this);
    this.nor = new NodeOperatorsRegistryService(this);
    this.sdvt = new NodeOperatorsRegistryService(this);
  }
}

export async function getLidoProtocol(): Promise<LidoProtocol> {
  const discoveryConfig = new DiscoveryConfig();
  const discoveryService = new DiscoveryService(discoveryConfig);
  const contracts = await discoveryService.discover();

  return new Protocol(contracts, discoveryService);
}
