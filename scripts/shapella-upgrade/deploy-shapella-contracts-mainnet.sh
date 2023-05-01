#!/bin/bash

export DEPLOYER=0x8Ea83AD72396f1E0cD2f8E72b1461db8Eb6aF7B5
export NETWORK=mainnet
export GAS_PRIORITY_FEE=3
export GAS_MAX_FEE=80

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
