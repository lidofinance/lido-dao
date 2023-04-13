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

yarn compile

export NETWORK_STATE_FILE_BASENAME="deployed-upgrade"
DEPLOYED_FILE="${NETWORK_STATE_FILE_BASENAME}-$NETWORK.json"
rm -f $DEPLOYED_FILE
cp $DEFAULT_CONFIG_FILE $DEPLOYED_FILE

yarn hardhat --network $NETWORK run ./scripts/shapella-upgrade/deploy-aragon-implementations.js

yarn hardhat --network $NETWORK run ./scripts/shapella-upgrade/deploy-non-aragon-contracts-no-proxy-binding.js

# manually run verify-contracts-code.sh
