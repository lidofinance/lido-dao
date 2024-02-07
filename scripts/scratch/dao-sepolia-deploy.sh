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

export GATE_SEAL_FACTORY=0x0000000000000000000000000000000000000000
export NETWORK=sepolia
export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

# Sepolia params: https://github.com/eth-clients/sepolia/blob/main/README.md
export GENESIS_TIME=1655733600

# EOA
export DSM_PREDEFINED_ADDRESS="0x6885E36BFcb68CB383DfE90023a462C03BCB2AE5"

export GAS_PRIORITY_FEE="${GAS_PRIORITY_FEE:=1}"
export GAS_MAX_FEE="${GAS_MAX_FEE:=100}"

# Deposit contract custom LIDO adapter
# deployed from scripts/deploy-sepolia-deposit-contract-adapter.js
export DEPOSIT_CONTRACT="0x80b5DC88C98E528bF9cb4B7F0f076aC41da24651"

bash scripts/scratch/dao-deploy.sh
