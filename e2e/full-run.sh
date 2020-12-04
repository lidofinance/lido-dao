#!/bin/bash
./startup.sh -r -s
yarn test:e2e
./shutdown.sh -r
