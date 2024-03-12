import { ethers } from "hardhat";

import { getContractAt, makeTx, TotalGasCounter } from "lib/deploy";
import { log } from "lib/log";
import { readNetworkState, Sk } from "lib/state-file";

async function main() {
  log.scriptStart(__filename);
  const deployer = (await ethers.provider.getSigner()).address;
  const state = readNetworkState({ deployer });

  // TODO
  // await assertLastEvent(template, 'TmplTokensIssued', null, state.lidoTemplate.deployBlock)
  log.splitter();

  // TODO: do need this?
  // const { fee } = state.daoInitialSettings
  // log(`Using fee initial settings:`)
  // log(`  total fee:`, chalk.yellow(`${fee.totalPercent}%`))
  // log(`  treasury fee:`, chalk.yellow(`${fee.treasuryPercent}%`))
  // log(`  node operators fee:`, chalk.yellow(`${fee.nodeOperatorsPercent}%`))

  // const tokenManager = await getContractAt('TokenManager', state[Sk.appTokenManager].proxy.address)
  // const daoToken = await artifacts.require('MiniMeToken').at(state.ldo.address)
  // // TODO: restore the assert
  // await assertVesting({
  //   tokenManager,
  //   token: daoToken,
  //   vestingParams: {
  //     ...state.vestingParams,
  //     unvestedTokensAmount: '0' // since we're minting them during the finalizeDAO call below
  //   }
  // })
  // log.splitter()

  const template = await getContractAt("LidoTemplate", state[Sk.lidoTemplate].address);
  await makeTx(
    template,
    "finalizeDAO",
    [state.daoAragonId, state.vestingParams.unvestedTokensAmount, state.stakingRouter.proxy.address],
    { from: state.deployer },
  );

  await TotalGasCounter.incrementTotalGasUsedInStateFile();
  log.scriptFinish(__filename);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error(error);
    process.exit(1);
  });
