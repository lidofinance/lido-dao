#!/bin/bash
source ./.env
set -e +u
set -o pipefail

ROOT=${PWD}
DATA_DIR="${ROOT}/data"

echo "Cleanup"
docker-compose down -v --remove-orphans
rm -rf $DATA_DIR
