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

export NETWORK=holesky
export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

# Holesky params: https://github.com/eth-clients/holesky/blob/main/README.md
export GENESIS_TIME=1695902400
export DEPOSIT_CONTRACT=0x4242424242424242424242424242424242424242

# export WITHDRAWAL_QUEUE_BASE_URI="<< SET IF REQUIED >>"

export GAS_PRIORITY_FEE="${GAS_PRIORITY_FEE:=1}"
export GAS_MAX_FEE="${GAS_MAX_FEE:=100}"

bash scripts/scratch/dao-deploy.sh
