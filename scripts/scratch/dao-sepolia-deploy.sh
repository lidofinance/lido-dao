#!/bin/bash
set -e +u
set -o pipefail

if [[ -z "$DEPLOYER" ]]; then
    echo "Must set DEPLOYER env variable" 1>&2
    exit 1
fi
if [[ -z "$RPC_URL" ]]; then
    echo "Must set RPC_URL env variable" 1>&2
    exit 1
fi
if [[ -z "$GATE_SEAL_FACTORY" ]]; then
    echo "Must set GATE_SEAL_FACTORY env variable" 1>&2
    exit 1
fi

export NETWORK=sepolia
export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

# Holesky params: https://github.com/eth-clients/holesky/blob/main/README.md
export GENESIS_TIME=1695902400

# TODO: set a dedicated EOA address (arwer is up to it).  Let it be a stub for now
export DSM_PREDEFINED_ADDRESS="0x000000000000000000000000000000000000dead"


# export WITHDRAWAL_QUEUE_BASE_URI="<< SET IF REQUIED >>"

export GAS_PRIORITY_FEE="${GAS_PRIORITY_FEE:=1}"
export GAS_MAX_FEE="${GAS_MAX_FEE:=100}"

# WTF??
export DEPOSIT_CONTRACT=0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D
ADAPTER_ADDRESS=$(yarn hardhat run --no-compile ./scripts/deploy-sepolia-deposit-contract-adapter.js --network $NETWORK)

export DEPOSIT_CONTRACT=ADAPTER_ADDRESS
bash scripts/scratch/dao-deploy.sh
