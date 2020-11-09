#!/usr/bin/env bash
set -eo pipefail

: ${NUM_ACCOUNTS:=10}
: ${RPC_ENDPOINT:=http://localhost:8545}
: ${CONTAINER_NAME:=geth}

echo 'Starting geth container...'

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker >/dev/null run -d --name "$CONTAINER_NAME" -p 8545:8545 \
  ethereum/client-go \
  --dev \
  --targetgaslimit 12000000 \
  --allow-insecure-unlock \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain '*' \
  --http.api 'eth,net,web3,personal,debug'

cleanup() {
  exit_code=$?
  trap - SIGINT EXIT
  echo 'Stopping geth container...'
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit "$exit_code"
}

trap cleanup SIGINT EXIT

REQ_BODY='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
HEADERS='Content-Type: application/json'

echo -n 'Waiting for geth to initialize...'
while ! curl -X POST -H "$HEADERS" -sfL0 -o /dev/null --data "$REQ_BODY" "$RPC_ENDPOINT"; do
  sleep 1 && echo -n .
done
echo

if [[ $NUM_ACCOUNTS != 1 ]]; then
  echo 'Geth started, populating accounts...'
  node ./populate-geth.js "$NUM_ACCOUNTS" "$RPC_ENDPOINT"
fi

docker logs --since 10m "$CONTAINER_NAME"
exec docker attach "$CONTAINER_NAME"
