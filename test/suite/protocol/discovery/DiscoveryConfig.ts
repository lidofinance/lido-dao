import hre from "hardhat";

import { log } from "lib";

import { networks, ProtocolNetworkConfig } from "./networks";

export class DiscoveryConfig {
  public readonly locatorAddress: string;
  public readonly agentAddress: string;
  public readonly votingAddress: string;

  private networkConfig: ProtocolNetworkConfig;

  constructor() {
    this.networkConfig = this.getNetworkConf();

    this.locatorAddress = process.env[this.networkConfig.env.locator] ?? this.networkConfig.defaults.locator ?? "";
    this.agentAddress = process.env[this.networkConfig.env.agent] ?? this.networkConfig.defaults.agent ?? "";
    this.votingAddress = process.env[this.networkConfig.env.voting] ?? this.networkConfig.defaults.voting ?? "";

    this.validateAddresses();

    log.debug("Discovery config", {
      "Network": hre.network.name,
      "Locator address": this.locatorAddress,
      "Agent address": this.agentAddress,
      "Voting address": this.votingAddress,
    });
  }

  private validateAddresses() {
    const error = (address: string, env: string) => {
      if (!address) {
        throw new Error(`${address} address is not set, please set it in the environment variables: ${env}`);
      }
    };

    error(this.locatorAddress, this.networkConfig.env.locator);
    error(this.agentAddress, this.networkConfig.env.agent);
    error(this.votingAddress, this.networkConfig.env.voting);
  }

  private getNetworkConf() {
    const config = networks[hre.network.name];
    if (!config) {
      throw new Error(`Network ${hre.network.name} is not supported`);
    }
    return config;
  }
}
