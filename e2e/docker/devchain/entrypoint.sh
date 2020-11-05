#!/usr/bin/env sh

BLOCK_TIME=${BLOCK_TIME:-"0"}
GAS_LIMIT=${GAS_LIMIT:-"0xb71b00"}
ACCOUNTS=${ACCOUNTS:-"50"}
AMOUNT=${AMOUNT:-"10000"}
NETWORK_ID=${NETWORK_ID:-"5"}
MNEMONIC=${MNEMONIC:-"explain tackle mirror kit van hammer degree position ginger unfair soup bonus"}

if [ ! "$(ls -A $DATA_DIR)" ]; then
  echo "Init from Aragon snapshot..."
  cp -R $ARAGEN_DIR/* $DATA_DIR
fi

echo "Starting Ganache..."
node /app/ganache-core.docker.cli.js -h 0.0.0.0 -a $ACCOUNTS -i $NETWORK_ID -l $GAS_LIMIT -e $AMOUNT -m "$MNEMONIC" -b $BLOCK_TIME --db=$DATA_DIR -q
