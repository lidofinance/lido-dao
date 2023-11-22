#!/bin/bash
set -e +u
set -o pipefail

#
export NETWORK=local
export RPC_URL="http://127.0.0.1:8545"

# If GateSeal factory is zero, deploy no GateSeal instance. Otherwise use the factory to deploy an instance
export GATE_SEAL_FACTORY=0x0000000000000000000000000000000000000000
export GENESIS_TIME=1639659600  # just some time
# export WITHDRAWAL_QUEUE_BASE_URI="<< SET IF REQUIED >>"
#
export DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export GAS_PRIORITY_FEE=1
export GAS_MAX_FEE=100
#
export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"

bash scripts/scratch/dao-deploy.sh
