#!/bin/bash

export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
export NETWORK=mainnet-fork-shapella-upgrade
# export GAS_PRICE=100000000000
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
