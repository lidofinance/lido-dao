#!/bin/bash
set -e +u
set -o pipefail

ARAGON_APPS_REPO_REF=import-shared-minime

if [[ -z "${DEPLOYER}" ]]; then
  echo "Env variable DEPLOYER must be set"
  exit 1
fi
echo "DEPLOYER is $DEPLOYER"

if [[ -z "${NETWORK}" ]]; then
  echo "Env variable NETWORK must be set"
  exit 1
fi
echo "NETWORK is $NETWORK"

function msg() {
  MSG=$1
  if [ ! -z "$MSG" ]; then
    echo ">>> ============================="
    echo ">>> $MSG"
    echo ">>> ============================="
  fi
}


# yarn install --immutable
yarn compile

rm -f ${NETWORK_STATE_FILE}
cp ${NETWORK_STATE_DEFAULTS_FILE} ${NETWORK_STATE_FILE}


# Fill in deployer, chainId, etc from env to the deploy artifact
yarn hardhat --network $NETWORK run ./scripts/scratch/00-populate-deploy-artifact-from-env.js  --no-compile

# It does not deploy DepositContract if it is specified in deployed-${NETWORK}-defaults.json
yarn hardhat --network $NETWORK run ./scripts/scratch/01-deploy-deposit-contract.js --no-compile
msg "Deposit contract deployed or is specified."

yarn hardhat --network $NETWORK run --no-compile ./scripts/scratch/02-deploy-aragon-env.js
msg "Aragon ENV deployed."

yarn hardhat run  --no-compile ./scripts/scratch/03-deploy-aragon-std-apps.js  --network $NETWORK
msg "Aragon STD apps deployed."

yarn hardhat --network $NETWORK run ./scripts/scratch/04-deploy-lido-template-and-bases.js --no-compile
yarn hardhat --network $NETWORK run ./scripts/scratch/05-obtain-deployed-instances.js --no-compile
msg "Apps instances deployed"

yarn hardhat --network $NETWORK run ./scripts/scratch/06-register-ens-domain.js --no-compile
msg "ENS registered"

yarn hardhat --network $NETWORK run ./scripts/scratch/07-deploy-apm.js --no-compile
yarn hardhat --network $NETWORK run ./scripts/scratch/08-obtain-deployed-apm.js --no-compile
msg "APM deployed"

yarn hardhat --network $NETWORK run ./scripts/scratch/09-create-app-repos.js --no-compile
msg "App repos created"

yarn hardhat --network $NETWORK run ./scripts/scratch/10-deploy-dao.js --no-compile

yarn hardhat --network $NETWORK run ./scripts/scratch/11-obtain-deployed-dao.js --no-compile
msg "DAO deploy started"

# Do it at the end, because might need the contracts initialized
yarn hardhat --network $NETWORK run ./scripts/scratch/12-issue-tokens.js --no-compile
msg "Tokens issued"

# Deploy the contracts before finalizing DAO, because the template might set permissions on some of them
yarn hardhat --network $NETWORK run ./scripts/scratch/13-deploy-non-aragon-contracts.js --no-compile
msg "Non-aragon contracts deployed"

yarn hardhat --network $NETWORK run ./scripts/scratch/14-gate-seal.js --no-compile

yarn hardhat --network $NETWORK run ./scripts/scratch/15-finalize-dao.js --no-compile
msg "DAO deploy finalized"

yarn hardhat --network $NETWORK run ./scripts/scratch/16-initialize-non-aragon-contracts.js --no-compile
msg "Non-aragon contracts initialized"

yarn hardhat --network $NETWORK run ./scripts/scratch/17-grant-roles.js --no-compile
msg "Roles granted"

yarn hardhat --network $NETWORK run ./scripts/scratch/18-plug-curated-staking-module.js --no-compile
msg "Plugged NodeOperatorsRegistry as Curated staking module"

yarn hardhat --network $NETWORK run ./scripts/scratch/19-transfer-roles.js --no-compile
msg "Role admin permissions transferred to Agent"

yarn hardhat --network $NETWORK run ./scripts/scratch/20-check-dao.js --no-compile
msg "The deployed protocol state checked"
