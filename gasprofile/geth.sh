#!/usr/bin/env bash
set -e

docker rm -f geth >/dev/null 2>&1 || true

exec docker run -it --name geth -p 8545:8545 ethereum/client-go \
  --dev \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain '*' \
  --http.api 'eth,net,web3,debug'
