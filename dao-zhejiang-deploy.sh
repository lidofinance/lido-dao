#!/bin/bash
set -e +u
set -o pipefail

export DEPLOYER=0xa5F1d7D49F581136Cf6e58B32cBE9a2039C48bA1

export NETWORK=zhejiang

# Set the variable to skip long Aragon apps frontend rebuild step on repetetive deploys
# export SKIP_APPS_LONG_BUILD_STEPS=1

bash dao-deploy.sh
