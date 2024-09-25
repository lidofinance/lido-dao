import fs from "node:fs/promises";
import path from "node:path";

import { HardhatRuntimeEnvironment } from "hardhat/types";

import { cy, log, yl } from "lib/log";

type DeployedContract = {
  contract: string;
  address: string;
  constructorArgs: unknown[];
};

type ProxyContract = {
  proxy: DeployedContract;
  implementation: DeployedContract;
};

type Contract = DeployedContract | ProxyContract;

type NetworkState = {
  deployer: string;
  [key: string]: Contract | string | number;
};

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;

export async function verifyDeployedContracts(_: unknown, hre: HardhatRuntimeEnvironment) {
  try {
    await verifyContracts(hre);
  } catch (error) {
    log.error("Error verifying deployed contracts:", error as Error);
    throw error;
  }
}

async function verifyContracts(hre: HardhatRuntimeEnvironment) {
  const network = hre.network.name;
  log("Verifying contracts for network:", network);

  const deployerAddress = await getDeployerAddress(hre);
  log("Deployer address:", deployerAddress);
  log.emptyLine();

  const networkState = await getNetworkState(network, deployerAddress);
  const deployedContracts = getDeployedContracts(networkState);
  await verifyContractList(deployedContracts, hre);
}

async function getDeployerAddress(hre: HardhatRuntimeEnvironment): Promise<string> {
  const deployer = await hre.ethers.provider.getSigner();
  if (!deployer) {
    throw new Error("Deployer not found!");
  }
  return deployer.address;
}

async function getNetworkState(network: string, deployerAddress: string): Promise<NetworkState> {
  const networkStateFile = `deployed-${network}.json`;
  const networkStateFilePath = path.resolve("./", networkStateFile);
  const data = await fs.readFile(networkStateFilePath, "utf8");
  const networkState = JSON.parse(data) as NetworkState;

  if (networkState.deployer !== deployerAddress) {
    throw new Error(`Deployer address mismatch: ${networkState.deployer} != ${deployerAddress}`);
  }

  return networkState;
}

function getDeployedContracts(networkState: NetworkState): DeployedContract[] {
  return Object.values(networkState)
    .filter((contract): contract is Contract => typeof contract === "object")
    .flatMap(getDeployedContract);
}

async function verifyContractList(contracts: DeployedContract[], hre: HardhatRuntimeEnvironment) {
  for (const contract of contracts) {
    await verifyContract(contract, hre);
  }
}

async function verifyContract(contract: DeployedContract, hre: HardhatRuntimeEnvironment) {
  if (await isContractVerified(contract.address, hre)) {
    log.success(`Contract ${yl(contract.contract)} at ${cy(contract.address)} is already verified!`);
    return;
  }

  const verificationParams = buildVerificationParams(contract);
  log.withArguments(
    `Verifying contract: ${yl(contract.contract)} at ${cy(contract.address)} with constructor args `,
    verificationParams.constructorArguments as string[],
  );

  try {
    await hre.run("verify:verify", verificationParams);
    log.success(`Successfully verified ${yl(contract.contract)}!`);
  } catch (error) {
    log.error(`Failed to verify ${yl(contract.contract)}:`, error as Error);
  }
  log.emptyLine();
}

function buildVerificationParams(contract: DeployedContract) {
  const contractName = contract.contract.split("/").pop()?.split(".")[0];
  return {
    address: contract.address,
    constructorArguments: contract.constructorArgs,
    contract: `${contract.contract}:${contractName}`,
  };
}

function getDeployedContract(contract: Contract): DeployedContract[] {
  if ("proxy" in contract && "implementation" in contract) {
    return [contract.proxy, contract.implementation];
  } else if ("contract" in contract && "address" in contract && "constructorArgs" in contract) {
    return [contract];
  }
  return [];
}

async function isContractVerified(address: string, hre: HardhatRuntimeEnvironment): Promise<boolean> {
  try {
    const apiURL = getEtherscanApiUrl(hre.network.name);
    const params = new URLSearchParams({
      module: "contract",
      action: "getsourcecode",
      address,
      apikey: getEtherscanApiKey(hre),
    });

    const result = await fetchContractSourceCode(apiURL, params);
    return isSourceCodeVerified(result);
  } catch (error) {
    console.error(`Failed to check verification status for contract ${address}:`, error);
    return false;
  }
}

function getEtherscanApiUrl(network: string): string {
  return `https://api${network !== "mainnet" ? `-${network}` : ""}.etherscan.io/api`;
}

function getEtherscanApiKey(hre: HardhatRuntimeEnvironment): string {
  const apiKey = hre.config.etherscan.apiKey;
  if (typeof apiKey === "string") {
    return apiKey;
  } else if (typeof apiKey === "object" && apiKey !== null) {
    return apiKey[hre.network.name] || "";
  }
  return "";
}

async function fetchContractSourceCode(apiURL: string, params: URLSearchParams) {
  return await retryFetch(`${apiURL}?${params}`, MAX_RETRY_ATTEMPTS, RETRY_DELAY_MS);
}

async function retryFetch(url: string, maxRetries: number, retryDelay: number) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "1" && data.result.length > 0) return data;

    if (data.message === "NOTOK" && data.result.includes("rate limit")) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    } else {
      return data;
    }
  }
  throw new Error(`Max retries reached. Unable to fetch.`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSourceCodeVerified(result: any): boolean {
  return result.status === "1" && result.result.length > 0 && result.result[0].SourceCode !== "";
}
