#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


npm i @aragon/cli eth-json-rpc-filters

"$ARAGON" ipfs install --local
