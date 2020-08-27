#!/usr/bin/env bash

set -eu
set -o pipefail


BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"


for PID_FILE in "$PID_DIR/.front.pid" "$PID_DIR/.ipfs.pid" "$PID_DIR/.devchain.pid"
do
    [[ -f "$PID_FILE" ]] || continue

    kill "$(cat "$PID_FILE")" || true
    rm "$PID_FILE"
done

echo DONE
