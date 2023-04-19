#!/bin/bash

# trap ctrl-c and call ctrl_c()
trap ctrl_c INT

local_rpc_port=7777
fork_pid=0

function ctrl_c() {
    if [[ $fork_pid > 0 ]]
    then
        echo "Stopping ganache"
        kill -15 $fork_pid
    fi
    exit 0
}

# Run ganache from the scripts at first with
(nc -vz 127.0.0.1 $local_rpc_port) &>/dev/null && kill -15 $(lsof -t -i:$local_rpc_port)
fork_command="npx ganache --chain.vmErrorsOnRPCResponse true --fork.blockNumber 17075073 --wallet.totalAccounts 10 --chain.chainId 1337 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000  --server.port $local_rpc_port --hardfork istanbul -d"
$fork_command &
fork_pid=$$

export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 # ganache account 0 (private key should be added to accounts.json)
export NETWORK=mainnet-fork-shapella-upgrade
export GAS_PRICE=0
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"
export LIDO_LOCATOR_PROXY_PREDEPLOYED="0xC1d0b3DE6792Bf6b4b37EccdcC24e45978Cfd2Eb"

sleep 10

bash scripts/shapella-upgrade/deploy-shapella-contracts.sh

sleep 2147483647
