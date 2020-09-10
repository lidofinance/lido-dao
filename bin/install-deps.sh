#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


( cd "$ROOT_DIR" && npm i && "$ARAGON" ipfs install --local )

for APP_DIR in "$ROOT_DIR/apps/"*; do
    APP_DIR="$(readlink -f "$APP_DIR")"
    echo Setting up $APP_DIR ...
    ( cd "$APP_DIR" && npm i )
done
