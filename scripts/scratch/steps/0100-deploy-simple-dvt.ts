import { expect } from "chai";
import { ethers } from "hardhat";

import { AppProxyUpgradeable, Kernel, LidoTemplate, NodeOperatorsRegistry } from "typechain-types";

import { findEvents, getContractPath, loadContract, makeTx, setValueInState, updateObjectInState } from "lib";
import { cy, log, yl } from "lib/log";
import { readNetworkState, Sk } from "lib/state-file";

const SIMPLE_DVT_APP_NAME = "simple-dvt";

const NULL_CONTENT_URI =
  "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

async function deployEmptyAppProxy(deployer: string, appName: string) {
  const state = readNetworkState({ deployer });

  const appFullName = `${appName}.${state[Sk.lidoApmEnsName]}`;
  const appId = ethers.namehash(appFullName);

  log.debug(`Deploying ${appName} proxy`, {
    "Kernel": state[Sk.aragonKernel].proxy.address,
    "Target App": appName,
    "Target App ENS": appFullName,
    "Target App ID": appId,
  });

  if (state[Sk.appSimpleDvt]) {
    log(`Simple DVT app already deployed at ${state[Sk.appSimpleDvt].proxy.address}`);
    return;
  }

  const kernelAddress = state[Sk.aragonKernel].proxy.address;
  const kernel = await loadContract<Kernel>("Kernel", kernelAddress);
  const receipt = await makeTx(kernel, "newAppProxy(address,bytes32)", [kernelAddress, appId], { from: deployer });

  const proxyAddress = findEvents(receipt, "NewAppProxy")[0].args.proxy;

  updateObjectInState(Sk.appSimpleDvt, {
    aragonApp: {
      name: appName,
      fullName: appFullName,
      id: appId,
    },
    proxy: {
      address: proxyAddress,
      contract: await getContractPath("AppProxyUpgradeable"),
      constructorArgs: [kernelAddress, appId, "0x"],
    },
  });

  log.success(`Deployed ${yl(appName)} proxy at ${cy(proxyAddress)}`);
}

async function deploySimpleDvt(deployer: string) {
  const state = readNetworkState({ deployer });

  const proxyAddress = state[Sk.appSimpleDvt].proxy.address;
  const lidoLocatorAddress = state[Sk.lidoLocator].proxy.address;
  const norImplAddress = state[Sk.appNodeOperatorsRegistry].implementation.address;

  const template = await loadContract<LidoTemplate>("LidoTemplate", state[Sk.lidoTemplate].address);

  // Set the simple DVT app implementation address to the Node Operators Registry implementation address
  const receipt = await makeTx(
    template,
    "createSimpleDVTApp",
    [[1, 0, 0], proxyAddress, norImplAddress, NULL_CONTENT_URI],
    {
      from: deployer,
    },
  );

  setValueInState(Sk.createSimpleDVTAppTx, receipt.hash);

  // Initialize the simple DVT app
  const proxy = await loadContract<NodeOperatorsRegistry>(
    "NodeOperatorsRegistry",
    state[Sk.appSimpleDvt].proxy.address,
  );

  const { stuckPenaltyDelay, stakingModuleTypeId } = state.simpleDvt.deployParameters;
  const simpleDvtInitOptions = [
    lidoLocatorAddress,
    "0x" + Buffer.from(stakingModuleTypeId).toString("hex").padEnd(64, "0"),
    stuckPenaltyDelay,
  ];

  await makeTx(proxy, "initialize", simpleDvtInitOptions, { from: deployer });

  updateObjectInState(Sk.appSimpleDvt, {
    ...state[Sk.appSimpleDvt],
    implementation: {
      address: norImplAddress,
      contract: await getContractPath("NodeOperatorsRegistry"),
      constructorArgs: [],
    },
  });
}

export async function main() {
  const deployer = (await ethers.provider.getSigner()).address;

  await deployEmptyAppProxy(deployer, SIMPLE_DVT_APP_NAME);

  await deploySimpleDvt(deployer);

  const state = readNetworkState({ deployer });

  const proxyAddress = state[Sk.appSimpleDvt].proxy.address;
  const kernelAddress = state[Sk.aragonKernel].proxy.address;
  const appId = state[Sk.appSimpleDvt].aragonApp.id;

  const appProxyUpgradeable = await loadContract<AppProxyUpgradeable>("AppProxyUpgradeable", proxyAddress);
  expect(await appProxyUpgradeable.kernel()).to.equal(kernelAddress);
  expect(await appProxyUpgradeable.appId()).to.equal(appId);
  expect(await appProxyUpgradeable.implementation()).to.equal(
    state[Sk.appNodeOperatorsRegistry].implementation.address,
  );

  const app = await loadContract<NodeOperatorsRegistry>("NodeOperatorsRegistry", proxyAddress);

  expect(await app.appId()).to.equal(appId);
  expect(await app.kernel()).to.equal(kernelAddress);
  expect(await app.hasInitialized()).to.be.true;
  expect(await app.getLocator()).to.equal(state[Sk.lidoLocator].proxy.address);
}
