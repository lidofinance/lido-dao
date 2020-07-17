#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


( cd "$ROOT_DIR" && npm i && "$ARAGON" ipfs install --local )
