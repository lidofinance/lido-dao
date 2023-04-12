#!/bin/bash

export DEPLOYER=0x2A78076BF797dAC2D25c9568F79b61aFE565B88C # deployerEOA
export NETWORK=mainnet-fork-shapella-upgrade-deployer-eoa
export GAS_PRICE=0
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
