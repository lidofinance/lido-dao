import { BaseContract, ContractDeployTransaction, ContractRunner } from "ethers";
import { artifacts, ethers } from "hardhat";

interface ContractHelper {
  name: string;
  contractPath: string;
  deploymentTx?: ContractDeployTransaction | unknown;
  address: string;
}

export type Contract = BaseContract & ContractHelper;

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
