import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { Kernel, LidoTemplate, NodeOperatorsRegistry } from "typechain-types";

import { findEvents, getContractPath, loadContract, makeTx, setValueInState, updateObjectInState } from "lib";
import { cy, log, yl } from "lib/log";
import { readNetworkState, Sk } from "lib/state-file";

const SIMPLE_DVT_APP_NAME = "simple-dvt";

const SIMPLE_DVT_MODULE_TYPE = "curated-onchain-v1";
const SIMPLE_DVT_MODULE_PENALTY_DELAY = 86400; // 1 day

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

  const appProxyUpgradeable = await ethers.getContractAt("AppProxyUpgradeable", proxyAddress);
  expect(await appProxyUpgradeable.kernel()).to.equal(kernelAddress);
  expect(await appProxyUpgradeable.appId()).to.equal(appId);
  expect(await appProxyUpgradeable.implementation()).to.equal(ZeroAddress);
}

async function deploySimpleDvt(deployer: string) {
  const state = readNetworkState({ deployer });

  if (state[Sk.appSimpleDvt]?.implementation) {
    log(`Simple DVT app already deployed at ${state[Sk.appSimpleDvt].implementation.address}`);
    return;
  }

  const norImplAddress = state[Sk.appNodeOperatorsRegistry].implementation.address;
  const lidoLocatorAddress = state[Sk.lidoLocator].proxy.address;

  const template = await loadContract<LidoTemplate>("LidoTemplate", state[Sk.lidoTemplate].address);

  // Set the simple DVT app implementation address to the Node Operators Registry implementation address
  const receipt = await makeTx(template, "createSimpleDVTApp", [[1, 0, 0], norImplAddress, NULL_CONTENT_URI], {
    from: deployer,
  });

  setValueInState(Sk.createSimpleDVTAppTx, receipt.hash);

  // Initialize the simple DVT app
  const proxy = await loadContract<NodeOperatorsRegistry>(
    "NodeOperatorsRegistry",
    state[Sk.appSimpleDvt].proxy.address,
  );

  const simpleDvtInitOptions = [
    lidoLocatorAddress,
    "0x" + Buffer.from(SIMPLE_DVT_MODULE_TYPE).toString("hex").padEnd(64, "0"),
    SIMPLE_DVT_MODULE_PENALTY_DELAY,
  ];

  await makeTx(proxy, "initialize", simpleDvtInitOptions, { from: deployer });
}

export async function main() {
  const deployer = (await ethers.provider.getSigner()).address;

  await deployEmptyAppProxy(deployer, SIMPLE_DVT_APP_NAME);

  await deploySimpleDvt(deployer);
}
