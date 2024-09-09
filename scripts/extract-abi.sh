#!/bin/bash

# This script is used to release the ABIs of the contracts to the public.
# It is used to update the ABIs in the lib/abi directory.

ARTEFACTS_DIR="artifacts"

# If the artifacts directory does not exist, compile the contracts
if [ ! -d "$ARTEFACTS_DIR" ]; then
    yarn compile
fi

yarn ts-node scripts/utils/extract-abi.ts
