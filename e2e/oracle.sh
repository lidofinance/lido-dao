#!/bin/bash
source ./.env
set -e +u
set -o pipefail

TMP_DIR=$PWD/tmp-oracle
IMG="lido-oracle:latest"

if [[ "$(docker images -q $IMG 2> /dev/null)" == "" ]] || [[ $REBUILD ]]; then
  echo "Building oracle Docker image..."
  rm -rf $TMP_DIR
  mkdir -p $TMP_DIR
  cd $TMP_DIR
  git clone git@github.com:lidofinance/py-oracle.git .
  docker build -t $IMG --no-cache .
  cd -
  rm -rf $TMP_DIR
fi
