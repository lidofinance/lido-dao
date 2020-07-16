#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


"$ARAGON" ipfs stop

kill "$(cat "$PID_DIR/.front.pid")" "$(cat "$PID_DIR/.devchain.pid")"
rm -f "$PID_DIR/.front.pid" "$PID_DIR/.devchain.pid"

echo DONE
