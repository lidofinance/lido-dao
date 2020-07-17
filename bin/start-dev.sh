#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


"$ARAGON" devchain --accounts 10 &
echo $! > "$PID_DIR/.devchain.pid"

"$ARAGON" ipfs start &
echo $! > "$PID_DIR/.ipfs.pid"

"$ARAGON" start --auto-open false &
echo $! > "$PID_DIR/.front.pid"
