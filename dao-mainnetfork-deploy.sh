#!/bin/bash
set -ex +u
set -o pipefail

# first local account by default
# DEPLOYER=${DEPLOYER:=0xC36894ECf19526b3Af600445E0E97BB0F5B57F33}
DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
NETWORK=${NETWORK:=mainnetfork}
ARAGON_APPS_REPO_REF=import-shared-minime

echo "DEPLOYER is $DEPLOYER"
echo "NETWORK is $NETWORK"

function msg() {
  MSG=$1
  if [ ! -z "$MSG" ]; then
    echo ">>> ============================="
    echo ">>> $MSG"
    echo ">>> ============================="
  fi
}

function pause() {
  MSG=$1
  msg "$1"
  read -s -n 1 -p "Press any key to continue . . ."
  echo ""
}


# yarn install --immutable
# yarn compile

rm -f deployed-$NETWORK.json
cp deployed-$NETWORK-defaults.json deployed-$NETWORK.json

yarn hardhat --network $NETWORK run ./scripts/multisig/33-deploy-lido-oracle-new.js

yarn deploy:$NETWORK:aragon-env
msg "Aragon ENV deployed."

declare -a contracts_with_custom_errors=(
    "0.8.9/proxy/OssifiableProxy.sol"
    "0.8.9/ValidatorExitBus.sol"
    "0.8.9/CommitteeQuorum.sol"
    "0.8.9/LidoOracleNew.sol"
    "0.8.9/test_helpers/LidoOracleNewMock.sol"
    "0.8.9/test_helpers/ValidatorExitBusMock.sol"
    "0.8.9/ReportEpochChecker.sol"
    "0.8.9/lib/RateLimitUtils.sol"
    "0.8.9/WithdrawalVault.sol"
    "0.8.9/StakingRouter.sol"
    "0.8.9/test_helpers/StakingRouterMock.sol"
    "0.8.9/WithdrawalQueue.sol"
    "0.8.9/BeaconChainDepositor.sol"
)
for f in "${contracts_with_custom_errors[@]}"
do
    mv "contracts/${f}" "contracts/${f}.bkp"
done

yarn deploy:$NETWORK:aragon-std-apps
msg "Aragon STD apps deployed."

for f in "${contracts_with_custom_errors[@]}"
do
    mv "contracts/${f}.bkp" "contracts/${f}"
done

yarn hardhat --network $NETWORK run --no-compile ./scripts/deploy-beacon-deposit-contract.js
msg "Deposit contract deployed."

yarn hardhat --network $NETWORK run ./scripts/multisig/01-deploy-lido-template-and-bases.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-1-deploy-template.json
pause "!!! Now set the daoTemplateDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-2-deploy-lido-base.json
pause "!!! Now set the lidoBaseDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-4-deploy-nops-base.json
pause "!!! Now set the nodeOperatorsRegistryBaseDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/02-obtain-deployed-instances.js
msg "Apps instances deployed"

yarn hardhat --network $NETWORK run ./scripts/multisig/03-register-ens-domain.js
if [ -f "tx-02-1-commit-ens-registration.json" ]; then
  yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-02-1-commit-ens-registration.json
fi
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-02-2-make-ens-registration.json
msg "ENS registered"

mv contracts/common/lib/MinFirstAllocationStrategy.sol contracts/common/lib/MinFirstAllocationStrategy.sol.48
mv contracts/common/lib/MinFirstAllocationStrategy.sol.4 contracts/common/lib/MinFirstAllocationStrategy.sol
mv contracts/0.8.9/StakingRouter.sol contracts/0.8.9/StakingRouter.sol.bkp
mv contracts/0.8.9/test_helpers/StakingRouterMock.sol contracts/0.8.9/test_helpers/StakingRouterMock.sol.bkp
mv contracts/0.8.9/test_helpers/MinFirstAllocationStrategyTest.sol contracts/0.8.9/test_helpers/MinFirstAllocationStrategyTest.sol.bkp

yarn hardhat --network $NETWORK run ./scripts/multisig/04-publish-app-frontends.js
msg "Frontend published to IPFS"

mv contracts/common/lib/MinFirstAllocationStrategy.sol contracts/common/lib/MinFirstAllocationStrategy.sol.4
mv contracts/common/lib/MinFirstAllocationStrategy.sol.48 contracts/common/lib/MinFirstAllocationStrategy.sol
mv contracts/0.8.9/StakingRouter.sol.bkp contracts/0.8.9/StakingRouter.sol
mv contracts/0.8.9/test_helpers/StakingRouterMock.sol.bkp contracts/0.8.9/test_helpers/StakingRouterMock.sol
mv contracts/0.8.9/test_helpers/MinFirstAllocationStrategyTest.sol.bkp contracts/0.8.9/test_helpers/MinFirstAllocationStrategyTest.sol

yarn hardhat --network $NETWORK run ./scripts/multisig/05-deploy-apm.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-03-deploy-apm.json
yarn hardhat --network $NETWORK run ./scripts/multisig/06-obtain-deployed-apm.js
msg "APM deployed"


yarn hardhat --network $NETWORK run ./scripts/multisig/07-create-app-repos.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-07-create-app-repos.json
msg "App repos created"

yarn hardhat --network $NETWORK run ./scripts/multisig/08-deploy-dao.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-05-deploy-dao.json

yarn hardhat --network $NETWORK run ./scripts/multisig/09-obtain-deployed-dao.js
msg "DAO deploy started"

yarn hardhat --network $NETWORK run ./scripts/multisig/10-issue-tokens.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-06-1-issue-tokens.json
msg "Tokens issued"

yarn hardhat --network $NETWORK run ./scripts/multisig/34-deploy-shapella-upgrade-contracts.js

# Insurance: deploy CompositePostRebaseBeaconReceiver
yarn hardhat --network $NETWORK run ./scripts/multisig/21-deploy-composite-post-rebase-beacon-receiver.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-21-deploy-composite-post-rebase-beacon-receiver.json
pause "!!! Now set the compositePostRebaseBeaconReceiverDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/22-obtain-composite-post-rebase-beacon-receiver.js
msg "CompositePostRebaseBeaconReceiver deployed"

# Insurance: deploy Burner
yarn hardhat --network $NETWORK run ./scripts/multisig/23-deploy-self-owned-steth-burner.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-23-deploy-self-owned-steth-burner.json
pause "!!! Now set the burnerDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/24-obtain-self-owned-steth-burner.js
msg "Burner deployed"

yarn hardhat --network $NETWORK run ./scripts/multisig/35-initialize-lido.js

yarn hardhat --network $NETWORK run ./scripts/multisig/11-finalize-dao.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-11-finalize-dao.json
msg "DAO deploy finalized"
