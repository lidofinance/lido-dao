#!/bin/bash

export DEPLOYER=0x2A78076BF797dAC2D25c9568F79b61aFE565B88C # Shapella deployerEOA
export GAS_PRIORITY_FEE=3
export GAS_MAX_FEE=60
export NETWORK=mainnet

export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
