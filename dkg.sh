#!/bin/bash
source ./.env
set -e +u
set -o pipefail

ROOT=$PWD
DOCKER_DIR=$ROOT/docker/dkg-pubkey
mkdir -p $DOCKER_DIR
cd $DOCKER_DIR
rm -rf dc4bc kyber-bls12381
git clone -b fix/full-flow-test git@github.com:depools/dc4bc.git
git clone git@github.com:depools/kyber-bls12381.git
docker build -t dkg .
docker run -v "$ROOT/data":/data -it dkg
rm -rf dc4bc kyber-bls12381
