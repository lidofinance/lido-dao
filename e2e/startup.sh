#!/bin/bash
source ./.env
set -e +u
set -o pipefail

ROOT=${PWD}
DATA_DIR="${ROOT}/data"
SNAPSHOTS_DIR=""${ROOT}/snapshots""
TESTNET_DIR="${DATA_DIR}/testnet"
DEVCHAIN_DIR="${DATA_DIR}/devchain"
IPFS_DIR="${DATA_DIR}/ipfs"

BEACONDATA1_DIR="${DATA_DIR}/beacondata-1"
BEACONDATA2_DIR="${DATA_DIR}/beacondata-2"
BEACONDATA3_DIR="${DATA_DIR}/beacondata-3"
BEACONDATA4_DIR="${DATA_DIR}/beacondata-4"

VALIDATORS_DIR="${DATA_DIR}/validators"

MOCK_VALIDATORS_DATA_DIR="${VALIDATORS_DIR}/mock_validators"
MOCK_VALIDATORS_KEYS_DIR="${MOCK_VALIDATORS_DATA_DIR}/validator_keys"
MOCK_VALIDATORS_DIR="${MOCK_VALIDATORS_DATA_DIR}/validators"

VALIDATORS1_DATA_DIR="${VALIDATORS_DIR}/validators1"
VALIDATORS1_VALIDATORS_KEYS_DIR="${VALIDATORS1_DATA_DIR}/validator_keys"
VALIDATORS1_VALIDATORS_DIR="${VALIDATORS1_DATA_DIR}/validators"

VALIDATORS2_DATA_DIR="${VALIDATORS_DIR}/validators2"
VALIDATORS2_VALIDATORS_KEYS_DIR="${VALIDATORS2_DATA_DIR}/validator_keys"
VALIDATORS2_VALIDATORS_DIR="${VALIDATORS2_DATA_DIR}/validators"

PASSWORD=123

NODE='npx babel-node --presets=@babel/preset-env'

while test $# -gt 0; do
  case "$1" in
    -h|--help)
      echo " = run eth1<->eth2 testnet = "
      echo " "
      echo "$0 [options]"
      echo " "
      echo "options:"
      echo "  -h | --help           show this help"
      echo "  -r | --reset          force reset all blockchains state (clear all data)"
      echo "  -d | --dao            force try to deploy dao"
      echo "  -r1 | --reset1        force reset ETH1 blockchain state"
      echo "  -r2 | --reset2        force reset ETH2 blockchain state"
      echo "  -n | --nodes          start 2nd and 3d eth2 nodes"
      echo "  -s | --snapshot       use snapshot instead deploy"
      echo "  -1 | --eth1           start only eth1 part"
      echo "  -w | --web            also start Aragon web UI"
      echo "  -ms | --makesnapshots create stage snapshots"
      exit 0
      ;;
    -r|--reset)
      RESET=true
      shift
      ;;
    -n|--nodes)
      NODES=true
      shift
      ;;
    -s|--snapshot)
      SNAPSHOT=true
      shift
      ;;
    -1|--eth1)
      ETH1_ONLY=true
      shift
      ;;
    -k|--keys)
      GEN_KEYS=true
      shift
      ;;
    -r1|--reset1)
      ETH1_RESET=true
      shift
      ;;
    -r2|--reset2)
      ETH2_RESET=true
      shift
      ;;
    -d|--dao)
      DAO_DEPLOY=true
      shift
      ;;
    -w|--web)
      WEB_UI=true
      shift
      ;;

    -ms|--makesnapshots)
      MAKE_SNAPSHOT=true
      shift
      ;;

    *)
      break
      ;;
  esac
done

if [ $RESET ]; then
  echo "Cleanup"
  docker-compose down -v --remove-orphans
  rm -rf $DATA_DIR
  mkdir -p $DATA_DIR
  ETH2_RESET=true
  DAO_DEPLOY=true
elif [ $ETH1_RESET ]; then
  echo "Reset ETH1 state"

  docker-compose rm -s -v -f node1 > /dev/null
  rm -rf $DEVCHAIN_DIR
  ETH2_RESET=true
# else
  # docker-compose unpause
fi

if [ ! -d $DEVCHAIN_DIR ]; then
  if [ $SNAPSHOT ]; then
    echo "Unzip devchain snapshot"
    unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/devchain.zip
  else
    DAO_DEPLOY=true
  fi
fi

if [ ! -d $TESTNET_DIR ]; then
  if [ $SNAPSHOT ]; then
    echo "Unzip testnet snapshot"
    unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/testnet.zip
  else
    ETH2_RESET=true
  fi
fi

echo "Starting eth1 node"
BLOCK_TIME=0 docker-compose up -d node1

if [ ! -d $IPFS_DIR ] && [ $SNAPSHOT ] && [ $WEB_UI ]; then
  echo "Unzip ipfs snapshot"
  unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/ipfs.zip
fi


echo -n "Waiting for eth1 rpc"
while ! curl --output /dev/null -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'; do
  sleep 2 && echo -n .
done
#sleep 3
#R="0x"
#while [[ "$R" != "0x60" ]];
#do
#  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DEPOSIT'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
#  sleep 2 && echo -n .
#done
echo " "
if [ ! $SNAPSHOT ] && [ $DAO_DEPLOY ] ; then
  echo "Starting IPFS"
  docker-compose up -d ipfs
  echo -n "Waiting for IPFS start"
  while ! curl --output /dev/null -s -f -L http://localhost:8080/api/v0/version; do
    sleep 2 && echo -n .
  done
  echo " "

  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DEPOSIT'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying deposit contract..."
    ADMIN="$(curl -s -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' | jq -r '.result[0]')"
    echo "Owner: $ADMIN"
    CODE=$(curl -s https://raw.githubusercontent.com/ethereum/eth2.0-specs/dev/solidity_deposit_contract/deposit_contract.json | jq -r '.bytecode' | cut -c 3-)
    # send deploy deposit contract tx, gasPrice = 20gwei
    HASH=$(curl -s -L -X POST http://localhost:8545 \
      --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{
      \"from\": \"$ADMIN\",
      \"gas\": \"0x20acc4\",
      \"gasPrice\": \"0x4a817c800\",
      \"value\": \"0x00\",
      \"data\": \"$CODE\"
    }],\"id\":1}" | jq -r '.result')
    echo "Tx hash: $HASH"
    # wait a bit for block mined
    sleep 3
    R=$(curl -s -L -X POST http://localhost:8545 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$HASH\"],\"id\":1}")
  #  HASH=$(echo "$R" | jq -r '.result.txHash')
    BLOCK_HEX=$(echo "$R" | jq -r '.result.blockNumber' | cut -c 3-)
    BLOCK=$((16#$BLOCK_HEX))
    ADDR=$(echo "$R" | jq -r '.result.contractAddress')
    echo "Deposit contract deployed: $ADDR at block $BLOCK"
  fi

  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$APM'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying APM..."
    npm run deploy:apm:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DEPOOL_APP'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying Apps..."
    npm run deploy:apps:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$TEMPLATE'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DAO template..."
    npm run deploy:tmpl:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DAO'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DAO..."
    npm run deploy:dao:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$CSTETH'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying CstETH wrapper..."
    npm run deploy:csteth:dev
  fi
  # wait a bit for block mining
  sleep 3
else
  echo "DevChain data exists"
  echo "Deposit contract predeployed: 0x$DEPOSIT at block $BLOCK"
  echo "DAO deployed at: 0x$DAO"
fi

if [ $WEB_UI ]; then
  echo "(Re)Starting IPFS"
  docker-compose up -d ipfs
  echo "Starting Aragon web UI"
  docker-compose up -d aragon
else
  echo "Stopping IPFS"
  docker-compose rm -s -v -f ipfs > /dev/null
fi

if [ ! -d $VALIDATORS_DIR ] && [ $SNAPSHOT ]; then
  echo "Unzip validators snapshot"
  unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/validators.zip
fi

if [ ! -d "$VALIDATORS1_VALIDATORS_KEYS_DIR" ]; then
  # TODO dkg
  echo "Generating $VALIDATOR_COUNT validator1 keys... (this may take a while)"
  KEYS_DIR=$VALIDATORS1_DATA_DIR ./deposit.sh --num_validators=$VALIDATOR_COUNT --password=$PASSWORD --chain=medalla --mnemonic="$VALIDATOR_MNEMONIC1" --withdrawal_pk=$WITHDRAWAL_PK1
fi

if [ ! -d "$VALIDATORS2_VALIDATORS_KEYS_DIR" ]; then
  echo "Generating $VALIDATOR_COUNT validator2 keys... (this may take a while)"
  KEYS_DIR=$VALIDATORS2_DATA_DIR ./deposit.sh --num_validators=$VALIDATOR_COUNT --password=$PASSWORD --chain=medalla --mnemonic="$VALIDATOR_MNEMONIC2" --withdrawal_pk=$WITHDRAWAL_PK2
fi

if [ $MAKE_SNAPSHOT ] && [ ! $SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/stage0 ]; then
  echo "Take snapshots for stage 0"
  mkdir -p $SNAPSHOTS_DIR/stage0
  docker-compose pause
  cd $DATA_DIR
  echo "Take snapshots for devchain"
  zip -rqu $SNAPSHOTS_DIR/stage0/devchain.zip devchain
  echo "Take snapshots for ipfs"
  zip -rqu $SNAPSHOTS_DIR/stage0/ipfs.zip ipfs
  echo "Take snapshots for validators"
  zip -rqu $SNAPSHOTS_DIR/stage0/validators.zip validators
  cd -
  docker-compose unpause
fi

if [ $ETH1_ONLY ]; then
  echo "ETH1 part done!"
  # snapshot stage 0
  exit 0
fi

if [ $ETH2_RESET ]; then
  if [ ! $RESET ]; then
    echo "Stopping ETH2 nodes"
    docker-compose rm -s -v -f node2-1 > /dev/null
    docker-compose rm -s -v -f node2-2 > /dev/null
    docker-compose rm -s -v -f node2-3 > /dev/null
    docker-compose rm -s -v -f node2-4 > /dev/null
    docker-compose rm -s -v -f mock-validators > /dev/null
    docker-compose rm -s -v -f validators1 > /dev/null
    docker-compose rm -s -v -f validators2 > /dev/null
  fi

  
  rm -rf $BEACONDATA1_DIR
  rm -rf $BEACONDATA2_DIR
  rm -rf $BEACONDATA3_DIR
  rm -rf $BEACONDATA4_DIR
  if [ ! $SNAPSHOT ]; then
    rm -rf $TESTNET_DIR
    echo "Updating lighthouse node"
    docker pull sigp/lighthouse

    docker-compose run --rm --no-deps lh lcli \
      --spec "$SPEC" \
      new-testnet --force \
      --deposit-contract-address "$DEPOSIT" \
      --deposit-contract-deploy-block "$BLOCK" \
      --testnet-dir "/data/testnet" \
      --min-genesis-active-validator-count "$MOCK_VALIDATOR_COUNT" \
      --eth1-follow-distance "$ETH1_FOLLOW_DISTANCE" \
      --genesis-delay "$GENESIS_DELAY" \
      --genesis-fork-version "$FORK_VERSION"

    if [ $SPEC = "minimal" ]; then
      # reduce slot time generation
      sed -i 's/SECONDS_PER_SLOT: "6"/SECONDS_PER_SLOT: "1"/' $TESTNET_DIR/config.yaml
      # set according eth1 block time generation, see docker-compose.yml
      # sed -i 's/SECONDS_PER_ETH1_BLOCK: "14"/SECONDS_PER_ETH1_BLOCK: "5"/' $TESTNET_DIR/config.yaml
      # fix deposit contract address
      sed -i "s/1234567890123456789012345678901234567890/$DEPOSIT/" $TESTNET_DIR/config.yaml
    fi

    echo "Specification generated at $TESTNET_DIR."

    if [ ! -d "$MOCK_VALIDATORS_KEYS_DIR" ]; then
      rm -rf $MOCK_VALIDATORS_DIR
      echo "Generating $MOCK_VALIDATOR_COUNT mock validator keys.. (this may take a while)"
      KEYS_DIR=$MOCK_VALIDATORS_DATA_DIR ./deposit.sh --num_validators=$MOCK_VALIDATOR_COUNT --password=$PASSWORD --chain=medalla --mnemonic="$MOCK_VALIDATOR_MNEMONIC"
    fi

    if [ ! -d "$MOCK_VALIDATORS_DIR" ]; then
      echo "Making deposits for $MOCK_VALIDATOR_COUNT genesis validators... (this may take a while)"
      $NODE scripts/mock_deposit.js
      echo "Sending ETH to mock users... (this may take a while)"
      $NODE scripts/mock_sendEth.js
      echo "Importing validators keystore"
      echo $PASSWORD | docker-compose run --rm --no-deps lh lighthouse \
        --spec "$SPEC" --debug-level "$DEBUG_LEVEL" \
        account validator import --reuse-password --stdin-inputs \
        --datadir "/data/validators/mock_validators" \
        --directory "/data/validators/mock_validators/validator_keys" \
        --testnet-dir "/data/testnet"
    fi

    echo "Generating genesis"
    docker-compose run --rm --no-deps lh lcli \
      --spec "$SPEC" \
      eth1-genesis \
      --testnet-dir "/data/testnet" \
      --eth1-endpoint http://node1:8545

  fi

  NOW=$(date +%s)
  echo "Reset genesis time to now ($NOW)"
  docker-compose run --rm --no-deps lh lcli \
    --spec "$SPEC" \
    change-genesis-time \
    /data/testnet/genesis.ssz \
    $NOW
fi

if [ ! -d "$VALIDATORS1_VALIDATORS_DIR" ]; then
  echo "Importing validators keystore"
  echo $PASSWORD | docker-compose run --rm --no-deps lh lighthouse \
    --spec "$SPEC" --debug-level "$DEBUG_LEVEL" \
    account validator import --reuse-password --stdin-inputs \
    --datadir "/data/validators/validators1" \
    --directory "/data/validators/validators1/validator_keys" \
    --testnet-dir "/data/testnet"
fi

if [ ! -d "$VALIDATORS2_VALIDATORS_DIR" ]; then
  echo "Importing validators keystore"
  echo $PASSWORD | docker-compose run --rm --no-deps lh lighthouse \
    --spec "$SPEC" --debug-level "$DEBUG_LEVEL" \
    account validator import --reuse-password --stdin-inputs \
    --datadir "/data/validators/validators2" \
    --directory "/data/validators/validators2/validator_keys" \
    --testnet-dir "/data/testnet"
fi
if [ $MAKE_SNAPSHOT ] && [ ! $SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/stage1 ]; then
  echo "Take snapshots for stage 1"
  mkdir -p $SNAPSHOTS_DIR/stage1
  docker-compose pause
  cd $DATA_DIR
  echo "Take snapshots for devchain"
  zip -rqu $SNAPSHOTS_DIR/stage1/devchain.zip devchain
  echo "Take snapshots for testnet"
  zip -rqu $SNAPSHOTS_DIR/stage1/testnet.zip testnet
  echo "Take snapshots for validators"
  zip -rqu $SNAPSHOTS_DIR/stage1/validators.zip validators
  cd -
  docker-compose unpause
fi

echo "Starting ETH2"
docker-compose up -d node1
docker-compose up -d node2-1 node2-2
sleep 5
docker-compose up -d mock-validators
docker-compose up -d validators1
sleep 5
docker-compose up -d validators2

# oracles
# echo "Building oracle container"
# ./oracle.sh
# docker-compose up -d oracle-1 oracle-2 oracle-3

if [ $NODES ]; then
  echo "Start extra nodes"
  docker-compose up -d node2-3 node2-4
fi

echo "All done!"
