#!/bin/bash
set -e +u
set -o pipefail

# first local account by default
DEPLOYER=${DEPLOYER:=0xb4124cEB3451635DAcedd11767f004d8a28c6eE7}
# NETWORK=kintsugi
NETWORK=${NETWORK:=local}


function msg() {
  MSG=$1
  if [ ! -z "$MSG" ]; then
    echo ">>> ============================="
    echo ">>> $MSG"
    echo ">>> ============================="
  fi
}

function pause() {
  MSG=$1
  msg "$1"
  read -s -n 1 -p "Press any key to continue . . ."
  echo ""
}

# Start the protocol
yarn hardhat --network $NETWORK run ./scripts/multisig/31-start-protocol.js
yarn hardhat --network $NETWORK tx --from $DEPLOYER --file tx-31-start-protocol.json
yarn hardhat --network $NETWORK run ./scripts/multisig/vote-and-enact.js
msg "Vote executed and the protocol is started (including staking)"

rm tx-31-start-protocol.json
msg "Protocol started!"
