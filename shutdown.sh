#!/bin/bash
source ./.env
set -e +u
set -o pipefail

LOCAL_DATA_DIR="${PWD}${DATADIR}"

echo "Cleanup"
docker-compose down -v --remove-orphans
rm -rf $LOCAL_DATA_DIR
