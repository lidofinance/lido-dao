#!/bin/bash
set -e +u
set -o pipefail

# first local account by default
export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
export NETWORK=${NETWORK:=mainnetfork}

bash dao-deploy.sh
