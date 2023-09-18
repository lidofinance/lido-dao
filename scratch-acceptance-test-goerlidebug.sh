#!/bin/bash
set -e +u
set -o pipefail


export NETWORK_STATE_FILE=deployed-goerlidebug.json
export HARDHAT_FORKING_URL=https://goerli.infura.io/v3/${WEB3_INFURA_PROJECT_ID}

yarn hardhat run --no-compile ./scripts/scratch/checks/scratch-acceptance-test.js --network hardhat
