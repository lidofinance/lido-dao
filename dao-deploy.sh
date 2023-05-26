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

rm -f deployed-$NETWORK.json
cp deployed-$NETWORK-defaults.json deployed-$NETWORK.json

# It does not deploy DepositContract if it is specified in deployed-${NETWORK}-defaults.json
yarn hardhat --network $NETWORK run --no-compile ./scripts/scratch/deploy-beacon-deposit-contract.js
msg "Deposit contract deployed or is specified."

yarn deploy:$NETWORK:aragon-env
msg "Aragon ENV deployed."

# NB!
# Need this renaming because during publishing of aragon apps and deploying their frontends
# via it's internal scripts all contracts get parsed. If contracts has custom errors or multiple
# verions declaration the process fails.

MULTI_VERSION_PRAGMA="pragma solidity >=0.4.24 <0.9.0;"
SINGLE_VERSION_PRAGMA="pragma solidity 0.4.24;"

for ff in $(find contracts/0.8.9 -iname '*.sol'); do mv "$ff" "$ff.tmp" ; done
for ff in $(grep -l -R "${MULTI_VERSION_PRAGMA}" contracts/common); do
    sed -i '' "s/${MULTI_VERSION_PRAGMA}/${SINGLE_VERSION_PRAGMA}/g" "$ff" ; done

mv contracts/0.4.24/template/LidoTemplate.sol contracts/0.4.24/template/LidoTemplate.sol.bkp
yarn deploy:$NETWORK:aragon-std-apps
msg "Aragon STD apps deployed."
mv contracts/0.4.24/template/LidoTemplate.sol.bkp contracts/0.4.24/template/LidoTemplate.sol

yarn hardhat --network $NETWORK run ./scripts/scratch/01-deploy-lido-template-and-bases.js

yarn hardhat --network $NETWORK run ./scripts/scratch/02-obtain-deployed-instances.js
msg "Apps instances deployed"

yarn hardhat --network $NETWORK run ./scripts/scratch/03-register-ens-domain.js
if [ -f "tx-02-1-commit-ens-registration.json" ]; then
  yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-02-1-commit-ens-registration.json
fi
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-02-2-make-ens-registration.json
msg "ENS registered"

yarn hardhat --network $NETWORK run ./scripts/scratch/04-publish-app-frontends.js
msg "Frontend published to IPFS"

# Okay, now we can restore the contracts
for ff in $(find contracts/0.8.9 -iname '*.sol.tmp'); do mv "$ff" "${ff%.*}" ; done
for ff in $(grep -l -R "${SINGLE_VERSION_PRAGMA}" contracts/common); do
    sed -i '' "s/${SINGLE_VERSION_PRAGMA}/${MULTI_VERSION_PRAGMA}/g" "$ff" ; done

yarn hardhat --network $NETWORK run ./scripts/scratch/05-deploy-apm.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-03-deploy-apm.json
yarn hardhat --network $NETWORK run ./scripts/scratch/06-obtain-deployed-apm.js
msg "APM deployed"


yarn hardhat --network $NETWORK run ./scripts/scratch/07-create-app-repos.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-07-create-app-repos.json
msg "App repos created"

yarn hardhat --network $NETWORK run ./scripts/scratch/08-deploy-dao.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-05-deploy-dao.json

yarn hardhat --network $NETWORK run ./scripts/scratch/09-obtain-deployed-dao.js
msg "DAO deploy started"


# Do it at the end, because might need the contracts initialized
yarn hardhat --network $NETWORK run ./scripts/scratch/10-issue-tokens.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-06-1-issue-tokens.json
msg "Tokens issued"


# Deploy the contracts before finalizing DAO, because the template might set permissions on some of them
yarn hardhat --network $NETWORK run ./scripts/scratch/13-deploy-non-aragon-contracts.js

yarn hardhat --network $NETWORK run ./scripts/scratch/11-finalize-dao.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-11-finalize-dao.json
msg "DAO deploy finalized"

rm ./tx-*.json

yarn hardhat --network $NETWORK run ./scripts/scratch/14-initialize-non-aragon-contracts.js

yarn hardhat --network $NETWORK run ./scripts/scratch/15-grant-roles.js

# TODO: save commit of the latest deploy
