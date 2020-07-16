
_die() {
    echo $* >&2
    exit 1
}

ROOT_DIR="$BIN_DIR/.."
PID_DIR='/tmp'

ARAGON="$ROOT_DIR/node_modules/.bin/aragon"
