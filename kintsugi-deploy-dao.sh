#!/bin/bash

# echo "{\"depositContractAddress\":\"0x4242424242424242424242424242424242424242\"}" > deployed-kl.json

yarn compile
yarn deploy:kintsugi:aragon-env
yarn deploy:kintsugi:aragon-std-apps
yarn deploy:kintsugi:apm-and-template
yarn deploy:kintsugi:apps
yarn deploy:kintsugi:dao