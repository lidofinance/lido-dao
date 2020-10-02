#!/bin/bash
source ./.env
set -e +u
set -o pipefail

TMP_DIR=$PWD/tmp-deposit-cli
IMG="depool-deposit-cli:latest"

if [[ "$(docker images -q $IMG 2> /dev/null)" == "" ]]; then
  # do something
  echo "Building deposit-cli Docker image..."
  rm -rf $TMP_DIR
  mkdir -p $TMP_DIR
  cd $TMP_DIR
  git clone -b custom-data https://github.com/depools/eth2.0-deposit-cli .
  docker build -t $IMG --no-cache .
  cd -
  rm -rf $TMP_DIR
fi

docker run -it -v $PWD/data:/data $IMG --folder /data "$@"
