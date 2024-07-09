type ProtocolNetworkItems = {
  locator: string;
  agent: string;
  voting: string;
};

export type ProtocolNetworkConfig = {
  env: Record<keyof ProtocolNetworkItems, string>;
  defaults: Record<keyof ProtocolNetworkItems, string>;
};

// TODO: inflate config from whatever source is available (yaml, json, etc)

const local: ProtocolNetworkConfig = {
  env: {
    locator: "LOCAL_LOCATOR_ADDRESS",
    agent: "LOCAL_AGENT_ADDRESS",
    voting: "LOCAL_VOTING_ADDRESS"
  },
  defaults: {
    locator: "",
    agent: "",
    voting: ""
  }
};

const mainnetFork: ProtocolNetworkConfig = {
  env: {
    locator: "MAINNET_LOCATOR_ADDRESS",
    agent: "MAINNET_AGENT_ADDRESS",
    voting: "MAINNET_VOTING_ADDRESS"
  },
  defaults: {
    locator: "0xC1d0b3DE6792Bf6b4b37EccdcC24e45978Cfd2Eb",
    agent: "0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c",
    voting: "0x2e59A20f205bB85a89C53f1936454680651E618e"
  }
};

export const networks: Record<string, ProtocolNetworkConfig> = {
  "local": local,
  "mainnet-fork": mainnetFork,
  "hardhat": mainnetFork
};
