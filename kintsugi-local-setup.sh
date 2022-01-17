#!/bin/bash

rm -f deployed-kl.json
yarn compile
yarn deploy:kl:aragon-env
yarn deploy:kl:aragon-std-apps
yarn deploy:kl:apm-and-template
yarn deploy:kl:apps
yarn deploy:kl:dao
yarn deploy:kl:perm
