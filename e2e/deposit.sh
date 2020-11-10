#!/bin/bash
source ./.env
set -e +u
set -o pipefail

KEYS_DIR=${KEYS_DIR:-$PWD/data}
TMP_DIR=$PWD/tmp-deposit-cli
IMG="lido-deposit-cli:latest"

if [[ "$(docker images -q $IMG 2> /dev/null)" == "" ]] || [[ $REBUILD ]]; then
  echo "Building deposit-cli Docker image..."
  rm -rf $TMP_DIR
  mkdir -p $TMP_DIR
  cd $TMP_DIR
  git clone -b custom-data https://github.com/lidofinance/eth2.0-deposit-cli .
  docker build -t $IMG --no-cache .
  cd -
  rm -rf $TMP_DIR
fi

docker run -it --rm -v $KEYS_DIR:/data $IMG --folder /data "$@"
