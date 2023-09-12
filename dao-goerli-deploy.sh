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
if [[ -z "$GATE_SEAL" ]]; then
    echo "Must set GATE_SEAL env variable" 1>&2
    exit 1
fi

export GENESIS_TIME=1639659600

export NETWORK=goerli
export CHAIN_ID=5

export GAS_PRIORITY_FEE="${GAS_PRIORITY_FEE:=1}"
export GAS_MAX_FEE="${GAS_MAX_FEE:=100}"
export NO_ARAGON_UI=1

export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

bash dao-deploy.sh
