#!/usr/bin/env bash

set -eu
set -o pipefail

BIN_DIR="$(cd $(dirname $0) && pwd)"
. "$BIN_DIR/.lib.sh"

. "$ROOT_DIR/dev.env.default"
if [[ -f "$ROOT_DIR/.dev.env" ]]; then
    . "$ROOT_DIR/.dev.env"
fi


if [ -z ${HOLDERS+x} ]; then
    HOLDERS="$(curl -s http://localhost:8545 --data '{"method":"eth_accounts","params":[],"id":1,"jsonrpc":"2.0"}' -H "Content-Type: application/json" -X POST | sed -Ee 's/.+result":(\[.+?\]).+/\1/')"
    STAKES='["1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000","1000000000000000000000000"]'
fi


# TODO "$ARAGON" dao new dao-template.depoolspm.eth
"$ARAGON" dao new company-template 1.0.0 --fn newTokenAndInstance --fn-args \
    "$TOKEN_NAME" "$TOKEN_SYMBOL" "$DAO_ID" \
    "$HOLDERS" "$STAKES" \
    "$VOTING_SETTINGS" \
    "$FINANCE_PERIOD" \
    "$USE_AGENT_AS_VAULT"
