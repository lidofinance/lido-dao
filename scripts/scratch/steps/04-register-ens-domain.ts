import { assert } from "chai";
import chalk from "chalk";
import { ethers } from "hardhat";

import { ENS__factory, IETHRegistrarController__factory, IInterfaceResolver__factory } from "typechain-types";

import { Contract, makeTx, TotalGasCounter } from "lib/deploy";
import { streccak } from "lib/keccak";
import { log, yl } from "lib/log";
import { readNetworkState, Sk } from "lib/state-file";

const TLD = "eth";
const CONTROLLER_INTERFACE_ID = "0x018fac06";

async function main() {
  log.scriptStart(__filename);
  const deployerSigner = await ethers.provider.getSigner();
  const deployer = deployerSigner.address;
  const state = readNetworkState(deployer);

  log.splitter();

  log(`Using ENS:`, yl(state[Sk.ens].address));
  const ens = ENS__factory.connect(state[Sk.ens].address, deployerSigner);

  const tldNode = ethers.namehash(TLD);

  const domainName = state[Sk.lidoApmEnsName];
  const domainOwner = state[Sk.lidoTemplate].address;
  const domainRegDuration = state[Sk.lidoApmEnsRegDurationSec];

  const node = ethers.namehash(domainName);

  log(`ENS domain: ${yl(`${domainName}`)} (${node})`);

  const domainParts = domainName.split(".");
  assert.lengthOf(domainParts, 2, `the domain is a second-level domain`);
  assert.equal(domainParts[1], TLD, `the TLD is the expected one`);
  const [domainLabel] = domainParts;

  const labelHash = streccak(domainLabel);

  log(`TLD node: ${chalk.yellow(TLD)} (${tldNode})`);
  log(`Label: ${chalk.yellow(domainLabel)} (${labelHash})`);

  if ((await ens.owner(node)) !== deployer && (await ens.owner(tldNode)) !== deployer) {
    // TODO
    throw new Error(`This branch is not implemented: refactor it if needed`);

    const tldResolverAddr = await ens.resolver(tldNode);
    log(`Using TLD resolver:`, yl(tldResolverAddr));
    // const tldResolver = await artifacts.require('IInterfaceResolver').at(tldResolverAddr)
    const tldResolver = IInterfaceResolver__factory.connect(tldResolverAddr, ethers.provider);

    const controllerAddr = await tldResolver.interfaceImplementer(tldNode, CONTROLLER_INTERFACE_ID);

    log(`Using TLD controller:`, yl(controllerAddr));
    // const controller = await artifacts.require('IETHRegistrarController').at(controllerAddr)
    const controller = await IETHRegistrarController__factory.connect(controllerAddr, ethers.provider);

    const controllerParams = await Promise.all([
      controller.minCommitmentAge(),
      controller.maxCommitmentAge(),
      controller.MIN_REGISTRATION_DURATION(),
    ]);

    const [minCommitmentAge, maxCommitmentAge, minRegistrationDuration] = controllerParams.map((x) => +x);

    log(`Controller min commitment age: ${yl(minCommitmentAge)} sec`);
    log(`Controller max commitment age: ${yl(maxCommitmentAge)} sec`);
    log(
      `Controller min registration duration: ${yl(formatTimeInterval(minRegistrationDuration))} (${minRegistrationDuration} sec)`,
    );

    log.splitter();

    log(`ENS domain owner:`, yl(domainOwner));
    log(`ENS domain registration duration: ${yl(formatTimeInterval(domainRegDuration))} (${domainRegDuration} sec)`);

    log.splitter();
    // TODO
    // assert.log(assert.isTrue, await controller.available(domainLabel), `the domain is available`)
    // assert.log(assert.isAtLeast, domainRegDuration, minRegistrationDuration, `registration duration is at least the minimum one`)
    log.splitter();

    const salt = "0x" + ethers.hexlify(ethers.randomBytes(32));
    log(`Using salt:`, yl(salt));

    const commitment = await controller.makeCommitment(domainLabel, domainOwner, salt);
    log(`Using commitment:`, yl(commitment));

    const rentPrice = await controller.rentPrice(domainLabel, domainRegDuration);
    console.log({ rentPrice });

    log(`Rent price:`, yl(`${ethers.formatUnits(rentPrice, "ether")} ETH`));

    // increasing by 15% to account for price fluctuation; the difference will be refunded
    const registerTxValue = rentPrice.muln(115).divn(100);
    log(`Register TX value:`, yl(`${ethers.formatUnits(registerTxValue, "ether")} ETH`));

    log.splitter();

    await makeTx(controller as unknown as Contract, "commit", [commitment], { from: deployer });

    await makeTx(controller as unknown as Contract, "register", [domainLabel, domainOwner, domainRegDuration, salt], {
      from: deployer,
      value: "0x" + registerTxValue.toString(16),
    });

    log.splitter();
  } else {
    log(`ENS domain new owner:`, yl(domainOwner));
    if ((await ens.owner(node)) === deployer) {
      log(`Transferring name ownership from owner ${chalk.yellow(deployer)} to template ${chalk.yellow(domainOwner)}`);
      await makeTx(ens as unknown as Contract, "setOwner", [node, domainOwner], { from: deployer });
    } else {
      log(`Creating the subdomain and assigning it to template ${chalk.yellow(domainOwner)}`);
      await makeTx(ens as unknown as Contract, "setSubnodeOwner", [tldNode, labelHash, domainOwner], {
        from: deployer,
      });
    }

    log.splitter();
  }

  await TotalGasCounter.incrementTotalGasUsedInStateFile();
  log.scriptFinish(__filename);
}

function formatTimeInterval(sec: number) {
  const HOUR = 60 * 60;
  const DAY = HOUR * 24;
  const MONTH = DAY * 30;
  const YEAR = DAY * 365;

  if (sec > YEAR) {
    return floor(sec / YEAR, 100) + " year(s)";
  }
  if (sec > MONTH) {
    return floor(sec / MONTH, 10) + " month(s)";
  }
  if (sec > DAY) {
    return floor(sec / DAY, 10) + " day(s)";
  }
  return `${sec} second(s)`;
}

function floor(n: number, multiplier: number) {
  return Math.floor(n * multiplier) / multiplier;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
