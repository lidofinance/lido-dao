#!/bin/bash
source ./.env
set -e +u
set -o pipefail

DOCKER_IMG_NAME="lido-oracle"

if [[ -z "${TAG}" ]] ; then
  echo "no TAG env provided. Using default \"e2e\"."
  TAG="e2e"
else
  echo "TAG=$TAG (from env)"
fi
GIT_CHECKOUT="tags/$TAG"

echo "Repo will be checked out from \"$GIT_CHECKOUT\" path"
echo "For docker image we'll use the following name and tag: \"$DOCKER_IMG_NAME:$TAG\" "

TMP_DIR=$PWD/tmp-oracle

if [[ "$(docker images -q $DOCKER_IMG_NAME:$TAG 2> /dev/null)" == "" ]] || [[ $REBUILD ]]; then
  echo "Building oracle Docker image..."
  rm -rf $TMP_DIR
  mkdir -p $TMP_DIR
  cd $TMP_DIR
  git clone git@github.com:lidofinance/lido-oracle.git .
  git checkout $GIT_CHECKOUT
  docker build -t $DOCKER_IMG_NAME:$TAG --no-cache .
  cd -
  rm -rf $TMP_DIR
fi
