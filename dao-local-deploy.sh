#!/bin/bash
set -e +u
set -o pipefail

# first local account by default
DEPLOYER=${DEPLOYER:=0xb4124cEB3451635DAcedd11767f004d8a28c6eE7}
NETWORK=${NETWORK:=local}
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

docker-compose down -v
docker-compose up --build -d

rm -f deployed-$NETWORK.json
cp deployed-$NETWORK-defaults.json deployed-$NETWORK.json

yarn install --immutable
yarn compile

yarn deploy:$NETWORK:aragon-env
msg "Aragon ENV deployed."
yarn deploy:$NETWORK:aragon-std-apps
msg "Aragon STD apps deployed."

yarn hardhat --network $NETWORK run --no-compile ./scripts/deploy-beacon-deposit-contract.js
msg "Deposit contract deployed."

yarn hardhat --network $NETWORK run ./scripts/multisig/01-deploy-lido-template-and-bases.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-1-deploy-template.json
pause "!!! Now set the daoTemplateDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-2-deploy-lido-base.json
pause "!!! Now set the lidoBaseDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-01-3-deploy-oracle-base.json
pause "!!! Now set the oracleBaseDeployTx hash value in deployed-$NETWORK.json"
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

yarn hardhat --network $NETWORK run ./scripts/multisig/04-publish-app-frontends.js
msg "Frontend published to IPFS"

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

# Execution Layer Rewards: deploy the vault
yarn hardhat --network $NETWORK run ./scripts/multisig/26-deploy-execution-layer-rewards-vault.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-26-deploy-execution-layer-rewards-vault.json
pause "!!! Now set the executionLayerRewardsVaultDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/27-obtain-deployed-execution-layer-rewards-vault.js
msg "ExecutionLayerRewardsVault deployed"

yarn hardhat --network $NETWORK run ./scripts/multisig/11-finalize-dao.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-11-finalize-dao.json
msg "DAO deploy finalized"

# Insurance: deploy CompositePostRebaseBeaconReceiver
yarn hardhat --network $NETWORK run ./scripts/multisig/21-deploy-composite-post-rebase-beacon-receiver.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-21-deploy-composite-post-rebase-beacon-receiver.json
pause "!!! Now set the compositePostRebaseBeaconReceiverDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/22-obtain-composite-post-rebase-beacon-receiver.js
msg "CompositePostRebaseBeaconReceiver deployed"

# Insurance: deploy Burner
yarn hardhat --network $NETWORK run ./scripts/multisig/23-deploy-burner.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-23-deploy-burner.json
pause "!!! Now set the burnerDeployTx hash value in deployed-$NETWORK.json"
yarn hardhat --network $NETWORK run ./scripts/multisig/24-obtain-burner.js
msg "Burner deployed"

# Insurance: attach the contracts to the protocol
yarn hardhat --network $NETWORK run ./scripts/multisig/25-vote-burner.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-25-vote-burner.json
yarn hardhat --network $NETWORK run ./scripts/multisig/vote-and-enact.js
msg "Vote for attaching the insurance module is executed"

# MAYBE TODO: Create and auto execute vote to increase vote time (like 10+5 minute)

# Check the deployed protocol
yarn hardhat --network $NETWORK run ./scripts/multisig/12-check-dao.js
msg "Check completed! Clening up..."

rm tx-*.json
msg "Deploy completed!"
