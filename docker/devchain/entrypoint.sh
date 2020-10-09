#!/usr/bin/env bash

DATA_DIR=${DATA_DIR:-"/data"}
BLOCK_TIME=${BLOCK_TIME:-"0"}
GAS_LIMIT=${GAS_LIMIT:-"12000000"}
MNEMONIC="explain tackle mirror kit van hammer degree position ginger unfair soup bonus"

mkdir -p $DATA_DIR
if [ ! "$(ls -A $DATA_DIR)" ]; then
  echo "Initializing chain data from snapshot"
  tar -xzf $ARAGEN_PKG -C $DATA_DIR --strip 2 package/aragon-ganache
else
  echo "Chain data exists. Assuming Deposit contract deployed: 0x5f4e510503d83bd1a5436bdae2923489da0be454 at block 70"
fi

echo "Starting Ganache..."
ganache-cli -h 0.0.0.0 -a 100 -i 5 -l $GAS_LIMIT -e 100000 -m "$MNEMONIC" -b $BLOCK_TIME --db=$DATA_DIR -q
