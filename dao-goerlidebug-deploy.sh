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

export GENESIS_TIME=1616508000  # Goerli genesis time
export DEPOSIT_CONTRACT=0xff50ed3d0ec03aC01D4C79aAd74928BFF48a7b2b

export NETWORK=goerlidebug
export CHAIN_ID=5

export GAS_PRIORITY_FEE="${GAS_PRIORITY_FEE:=1}"
export GAS_MAX_FEE="${GAS_MAX_FEE:=100}"

export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

bash dao-deploy.sh
