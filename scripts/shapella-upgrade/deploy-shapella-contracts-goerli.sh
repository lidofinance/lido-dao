#!/bin/bash

export DEPLOYER=0xa5F1d7D49F581136Cf6e58B32cBE9a2039C48bA1
export NETWORK=goerli
export GAS_PRICE=100000000000

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
