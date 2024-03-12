import { assert } from "chai";
import chalk from "chalk";
import { ethers } from "hardhat";

import { ENS__factory } from "typechain-types";

import { getContractAt } from "lib/contract";
import { makeTx, TotalGasCounter } from "lib/deploy";
import { getENSNodeOwner } from "lib/ens";
import { findEvents } from "lib/event";
import { streccak } from "lib/keccak";
import { log, logSplitter, yl } from "lib/log";
import { readNetworkState, Sk, updateObjectInState } from "lib/state-file";

async function main() {
  log.scriptStart(__filename);

  const deployer = (await ethers.provider.getSigner()).address;
  let state = readNetworkState({ deployer });
  const templateAddress = state.lidoTemplate.address;

  logSplitter();
  log(`APM ENS domain: ${chalk.yellow(state.lidoApmEnsName)}`);
  log(`Using DAO template: ${chalk.yellow(templateAddress)}`);

  // const template = await artifacts.require('LidoTemplate').at(daoTemplateAddress)
  const template = await getContractAt("LidoTemplate", templateAddress);
  if (state.lidoTemplate.deployBlock) {
    log(`Using LidoTemplate deploy block: ${chalk.yellow(state.lidoTemplate.deployBlock)}`);
  }
  log.splitter();
  // TODO
  // await assertNoEvents(template, null, state.lidoTemplate.deployBlock)

  // const ens = await artifacts.require('ENS').at(state.ens.address)
  const ens = ENS__factory.connect(state[Sk.ens].address, ethers.provider);
  const lidoApmEnsNode = ethers.namehash(state.lidoApmEnsName);
  const lidoApmEnsNodeOwner = await getENSNodeOwner(ens, lidoApmEnsNode);
  const checkDesc = `ENS node is owned by the DAO template`;

  assert.equal(lidoApmEnsNodeOwner, templateAddress, checkDesc);
  log.success(checkDesc);

  logSplitter();

  const domain = splitDomain(state.lidoApmEnsName);
  const parentHash = ethers.namehash(domain.parent);
  const subHash = streccak(domain.sub);

  log(`Parent domain: ${chalk.yellow(domain.parent)} ${parentHash}`);
  log(`Subdomain label: ${chalk.yellow(domain.sub)} ${subHash}`);

  logSplitter();

  const lidoApmDeployArguments = [parentHash, subHash];
  const receipt = await makeTx(template, "deployLidoAPM", lidoApmDeployArguments, { from: deployer });
  state = updateObjectInState(Sk.lidoApm, {
    deployArguments: lidoApmDeployArguments,
    deployTx: receipt.hash,
  });

  const registryAddress = findEvents(receipt, "TmplAPMDeployed")[0].args.apm;
  log.splitter(`Using APMRegistry: ${yl(registryAddress)}`);

  state = updateObjectInState(Sk.lidoApm, { address: registryAddress });

  await TotalGasCounter.incrementTotalGasUsedInStateFile();
  log.scriptFinish(__filename);
}

function splitDomain(domain: string) {
  const dotIndex = domain.indexOf(".");
  if (dotIndex === -1) {
    throw new Error(`the ENS domain ${domain} is a top-level domain`);
  }
  return {
    sub: domain.substring(0, dotIndex),
    parent: domain.substring(dotIndex + 1),
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
