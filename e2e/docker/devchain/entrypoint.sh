#!/usr/bin/env sh

DATA_DIR=${DATA_DIR:-"/data"}
BLOCK_TIME=${BLOCK_TIME:-"0"}
GAS_LIMIT=${GAS_LIMIT:-"12000000"}
MNEMONIC="explain tackle mirror kit van hammer degree position ginger unfair soup bonus"

mkdir -p $DATA_DIR
if [ ! "$(ls -A $DATA_DIR)" ]; then
  echo "Initializing chain data from Aragen snapshot"
  cd /tmp
  wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG
  tar -xzf $ARAGEN_PKG -C $DATA_DIR --strip 2 package/aragon-ganache
  rm -f $ARAGEN_PKG
  cd -
else
  echo "Chain data exists. Assuming Deposit contract deployed: 0x5f4e510503d83bd1a5436bdae2923489da0be454 at block 70"
fi

echo "Starting Ganache..."
node /app/ganache-core.docker.cli.js -h 0.0.0.0 -a 50 -i 5 -l $GAS_LIMIT -e 1000 -m "$MNEMONIC" -b $BLOCK_TIME --db=$DATA_DIR -q
