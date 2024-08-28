#!/bin/bash
set -e +u
set -o pipefail

export NETWORK=local
export RPC_URL=${RPC_URL:="http://127.0.0.1:8555"}  # if defined use the value set to default otherwise

export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="scripts/scratch/deployed-testnet-defaults.json"

bash scripts/dao-deploy.sh

# Need this to get sure the last transactions are mined
yarn hardhat --network $NETWORK run --no-compile scripts/scratch/send-hardhat-mine.ts
