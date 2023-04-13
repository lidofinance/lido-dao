#!/bin/bash

# trap ctrl-c and call ctrl_c()
trap ctrl_c INT

fork_pid=0

function ctrl_c() {
    if [[ $fork_pid > 0 ]]
    then
        echo "Stopping ganache"
        kill -9 $fork_pid
    fi
    exit 0
}

# Run ganache from the scripts at first with
fork_command="npx ganache --chain.vmErrorsOnRPCResponse true --wallet.totalAccounts 10 --chain.chainId 1337 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000  --server.port 7777 --hardfork istanbul -d"
$fork_command &
fork_pid=$$

export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 # ganache account 0 (private key should be added to accounts.json)
export NETWORK=mainnet-fork-shapella-upgrade
export GAS_PRICE=0
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"

sleep 15

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh

sleep 2147483647
