#!/bin/bash

# Run ganache from the scripts at first with
# ./ganache.sh --chain.vmErrorsOnRPCResponse true --wallet.totalAccounts 10 --chain.chainId 1337 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000  --server.port 7777 --hardfork istanbul -d
export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 # ganache account 0 (private key should be added to accounts.json)
export NETWORK=mainnet-fork-shapella-upgrade
# export GAS_PRICE=100000000000
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh
