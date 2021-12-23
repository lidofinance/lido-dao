#!/bin/bash


cd ./e2e
docker-compose down -v
rm -rf ./data
NETWORK_ID=1337 docker-compose up -d --build ipfs node1 aragon
cd -