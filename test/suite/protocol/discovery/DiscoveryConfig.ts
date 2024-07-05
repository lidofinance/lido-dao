import hre from "hardhat";

import { log } from "lib";

interface NetworkConf {
  getLocatorAddress(): string;

  getAgentAddress(): string;

  getVotingAddress(): string;

  defaultLocatorAddress(): string;

  defaultAgentAddress(): string;

  defaultVotingAddress(): string;
}

class LocalNetworkConf implements NetworkConf {
  getLocatorAddress = (): string => "LOCAL_LOCATOR_ADDRESS";
  getAgentAddress = (): string => "LOCAL_AGENT_ADDRESS";
  getVotingAddress = (): string => "LOCAL_VOTING_ADDRESS";

  defaultLocatorAddress = (): string => "";
  defaultAgentAddress = (): string => "";
  defaultVotingAddress = (): string => "";
}

class MainnetForkConf implements NetworkConf {
  getAgentAddress = (): string => "MAINNET_AGENT_ADDRESS";
  getLocatorAddress = (): string => "MAINNET_LOCATOR_ADDRESS";
  getVotingAddress = (): string => "MAINNET_VOTING_ADDRESS";

  // https://docs.lido.fi/deployed-contracts
  defaultLocatorAddress = (): string => "0xC1d0b3DE6792Bf6b4b37EccdcC24e45978Cfd2Eb";
  defaultAgentAddress = (): string => "0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c";
  defaultVotingAddress = (): string => "0x2e59A20f205bB85a89C53f1936454680651E618e";
}

export class DiscoveryConfig {
  public readonly locatorAddress: string;
  public readonly agentAddress: string;
  public readonly votingAddress: string;

  private readonly networkConf: NetworkConf;

  constructor() {
    this.networkConf = this.getNetworkConf();

    this.locatorAddress =
      process.env[this.networkConf.getLocatorAddress()] ?? this.networkConf.defaultLocatorAddress() ?? "";
    this.agentAddress = process.env[this.networkConf.getAgentAddress()] ?? this.networkConf.defaultAgentAddress() ?? "";
    this.votingAddress =
      process.env[this.networkConf.getVotingAddress()] ?? this.networkConf.defaultVotingAddress() ?? "";

    this.validateAddresses();

    log.debug("Discovery config", {
      Network: hre.network.name,
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

    error(this.locatorAddress, this.networkConf.getLocatorAddress());
    error(this.agentAddress, this.networkConf.getAgentAddress());
    error(this.votingAddress, this.networkConf.getVotingAddress());
  }

  private getNetworkConf(): NetworkConf {
    switch (hre.network.name) {
      case "local":
        return new LocalNetworkConf();
      case "mainnet-fork":
        return new MainnetForkConf();
      default:
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }
  }
}
