#!/usr/bin/env bash

DATA_DIR=${DATA_DIR:-"/data"}
BLOCK_TIME=${BLOCK_TIME:-"0"}
GAS_LIMIT=${GAS_LIMIT:-"12000000"}
MNEMONIC="explain tackle mirror kit van hammer degree position ginger unfair soup bonus"

mkdir -p $DATA_DIR
if [ ! "$(ls -A $DATA_DIR)" ]; then
  echo "Initializing chain data from snapshot"
  tar -xzf aragen.tgz -C $DATA_DIR --strip 2 package/aragon-ganache

#  echo "Starting Ganache temporary for deploy Deposit contract..."
#  ganache-cli -h 0.0.0.0 -a 10 -i 5 -l $GAS_LIMIT -e 100000 -m "$MNEMONIC" --db=$DATA_DIR 2>&1 > /dev/null &
#  PID=$!
#  echo -n "Waiting for Ganache starts"
#  while ! curl --output /dev/null -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'; do
#    sleep 1 && echo -n .
#  done
#  echo " "
#  echo "Deploying deposit contract..."
#  ADMIN="$(curl -s -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' | jq -r '.result[0]')"
#  echo "Owner: $ADMIN"
#  CODE=$(jq -r '.bytecode' deposit_contract.json | cut -c 3-)
#  # send deploy deposit contract tx, gasPrice = 20gwei
#  HASH=$(curl -s -L -X POST http://localhost:8545 \
#    --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{
#    \"from\": \"$ADMIN\",
#    \"gas\": \"0x20acc4\",
#    \"gasPrice\": \"0x4a817c800\",
#    \"value\": \"0x00\",
#    \"data\": \"$CODE\"
#  }],\"id\":1}" | jq -r '.result')
#  echo "Tx hash: $HASH"
#  # wait a bit for block mined
#  sleep 3
#  R=$(curl -s -L -X POST http://localhost:8545 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$HASH\"],\"id\":1}")
##  HASH=$(echo "$R" | jq -r '.result.txHash')
#  BLOCK_HEX=$(echo "$R" | jq -r '.result.blockNumber' | cut -c 3-)
#  BLOCK=$((16#$BLOCK_HEX))
#  ADDR=$(echo "$R" | jq -r '.result.contractAddress')
#  echo "Deposit contract deployed: $ADDR at block $BLOCK"
#  kill $PID
#  sleep 3
else
  echo "Chain data exists. Assuming Deposit contract deployed: 0x5f4e510503d83bd1a5436bdae2923489da0be454 at block 70"
fi


#echo "Starting IPFS..."
#ipfs daemon --migrate=true &
echo "Starting Ganache..."
ganache-cli -h 0.0.0.0 -a 10 -i 5 -l $GAS_LIMIT -e 100000 -m "$MNEMONIC" -b $BLOCK_TIME --db=$DATA_DIR -q
