#!/bin/bash
# set -e

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

export DEPLOYER=0xBC862d4beE4E1cd82B9e8519b4375c3457fc6A5a # ganache account 0 (private key should be added to accounts.json)
export NETWORK=mainnet-fork-shapella-upgrade
export GAS_PRICE=0
export DEFAULT_CONFIG_FILE="deployed-mainnet-upgrade-defaults.json"
export LIDO_LOCATOR_PROXY_PREDEPLOYED="0xC1d0b3DE6792Bf6b4b37EccdcC24e45978Cfd2Eb"
export NETWORK_STATE_FILE_BASENAME="deployed-upgrade"

key_json_prefix="\"${NETWORK}\": [\""
key_json_postfix='"]'
line=$(grep '"mainnet-fork-shapella-upgrade"' accounts.json)
text="${line#*${key_json_prefix}}"
text="${text%${key_json_postfix}*}"
deployer_private_key="0x${text}"

fork_command="npx ganache --chain.vmErrorsOnRPCResponse true --account \"$deployer_private_key,100000000000000000000\" --chain.chainId 1337 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000 --server.host 127.0.0.1 --server.port $local_rpc_port --hardfork istanbul -d -u $DEPLOYER"
$fork_command &
fork_pid=$$

sleep 10

DEPLOYED_FILE="${NETWORK_STATE_FILE_BASENAME}-$NETWORK.json"
rm -f $DEPLOYED_FILE
cp $DEFAULT_CONFIG_FILE $DEPLOYED_FILE
bash scripts/shapella-upgrade/deploy-shapella-contracts.sh

sleep 2147483647
