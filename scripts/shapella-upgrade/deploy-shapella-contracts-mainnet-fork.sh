#!/bin/bash

export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
export NETWORK=mainnet-fork-shapella-upgrade

# ldo megaholder
export TEMPLATE_PROXY_ADMIN=0xa5F1d7D49F581136Cf6e58B32cBE9a2039C48bA1

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
