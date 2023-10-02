#!/bin/bash
set -e +u
set -o pipefail

#
export NETWORK=local
export CHAIN_ID=1337
export RPC_URL="http://127.0.0.1:8545"
export GATE_SEAL=0x0000000000000000000000000000000000000000
export GENESIS_TIME=1639659600  # just some time
#
export DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export GAS_PRIORITY_FEE=1
export GAS_MAX_FEE=100
#
export NETWORK_STATE_FILE="deployed-${NETWORK}.json"
export NETWORK_STATE_DEFAULTS_FILE="deployed-testnet-defaults.json"
# TODO export SCRATCH_DEPLOY_DEPOSIT_CONTRACT=1

# Set the variable to skip long Aragon apps frontend rebuild step on repetetive deploys
# export SKIP_APPS_LONG_BUILD_STEPS=1

bash dao-deploy.sh
