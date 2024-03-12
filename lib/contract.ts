import { BaseContract, ContractRunner } from "ethers";
import { artifacts, ethers } from "hardhat";

interface ContractHelper {
  name: string;
  contractPath: string;
  address: string;
}

interface DeployedContractHelper {
  deploymentTx: string;
}

export type Contract = BaseContract & ContractHelper;

export type DeployedContract = Contract & DeployedContractHelper;

type ConnectFuncType = (address: string, runner?: ContractRunner | null) => unknown;

export interface ContractFactoryHelper {
  connect: ConnectFuncType;
}

// export type ContractFactoryInterface = ContractFactory & ContractFactoryHelper;

export async function getContractAt(name: string, address: string): Promise<Contract> {
  const contract = (await ethers.getContractAt(name, address)) as unknown as Contract;
  const artifact = await artifacts.readArtifact(name);
  // TODO: use updateWithNameAndPath
  contract.name = name;
  contract.contractPath = artifact.sourceName;
  contract.address = await contract.getAddress();
  return contract as unknown as Contract;
}

export async function getContractPath(contractName: string) {
  const artifact = await artifacts.readArtifact(contractName);
  return artifact.sourceName;
}
