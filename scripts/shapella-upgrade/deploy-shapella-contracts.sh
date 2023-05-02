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

yarn hardhat --network $NETWORK run ./scripts/shapella-upgrade/deploy-aragon-implementations.js

yarn hardhat --network $NETWORK run ./scripts/shapella-upgrade/deploy-non-aragon-contracts-no-proxy-binding.js

# manually run verify-contracts-code.sh
