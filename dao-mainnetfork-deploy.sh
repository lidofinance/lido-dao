#!/bin/bash
set -e +u
set -o pipefail

export DEPLOYER=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1

export NETWORK=mainnetfork

# Set the variable to skip long Aragon apps frontend rebuild step on repetetive deploys
# export SKIP_APPS_LONG_BUILD_STEPS=1

bash dao-deploy.sh
