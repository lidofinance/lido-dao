#!/bin/bash
source ./.env
set -e +u
set -o pipefail

TAG=${DEPOSIT_CLI_DOCKER_TAG:-"latest"}
KEYS_DIR=${KEYS_DIR:-$PWD/data}
TMP_DIR=$PWD/tmp-deposit-cli
IMG="lidofinance/deposit-cli:$TAG"

if [[ $REBUILD ]]; then
  echo "Building deposit-cli Docker image..."
  rm -rf $TMP_DIR
  mkdir -p $TMP_DIR
  cd $TMP_DIR
  git clone https://github.com/lidofinance/eth2.0-deposit-cli .
  docker build -t $IMG --no-cache .
  cd -
  rm -rf $TMP_DIR
fi

DEPOSIT="docker run -it --rm -v $KEYS_DIR:/data $IMG"
if [[ $@ ]]; then
  $DEPOSIT existing-mnemonic --quiet --validator_start_index 0 --folder /data "$@"
else
  $DEPOSIT
fi
