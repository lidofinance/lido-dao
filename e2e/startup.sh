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

DEPLOYED_FILE="../deployed.json"
STAGE="2"

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
      echo "  -d | --deploy         force try to deploy contracts"
      echo "  -r1 | --reset1        force reset ETH1 blockchain state"
      echo "  -r2 | --reset2        force reset ETH2 blockchain state"
      echo "  -n | --nodes          start 2nd and 3d eth2 nodes"
      echo "  -s | --snapshot       use snapshot instead deploy"
      echo "  --stage [id]          uset stage id for snapshots (2 by default)"
      echo "  -1 | --eth1           start only eth1 part"
      echo "  -w | --web            also start Aragon web UI"
      echo "  -ms | --makesnapshots create stage snapshots"
      echo "  -o | --oracles        start oracles"
      echo "  -os | --seed          seed mock data"
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
    --stage)
      STAGE=${2:-"2"}
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
      DEPLOY=true
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
    -o|--oracles)
      ORACLES=true
      shift
      ;;
    -os|--seed)
      SEED=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ $RESET ]; then
  echo "Cleanup"
  docker-compose down -v --remove-orphans
  rm -rf $DATA_DIR
  mkdir -p $DATA_DIR

  echo "Reset deployed.json"
  node ./scripts/deployed-reset.js $NETWORK_ID "e2e" $OWNER $HOLDERS
  ETH2_RESET=true
  DEPLOY=true
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
    echo "Unzip devchain snapshot from stage $STAGE"
    unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/stage$STAGE/devchain.zip
    echo "Restore deployed.json"
    node ./scripts/deployed-restore.js $NETWORK_ID $SNAPSHOTS_DIR/stage1
  else
    DEPLOY=true
  fi
fi


RPC_ENDPOINT=${RPC_ENDPOINT:-http://localhost:8545}
REQ_BODY='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
HEADERS='Content-Type: application/json'

if [ ! $SNAPSHOT ] && [ $DEPLOY ] ; then
  echo "Starting ETH1 node in onDemand mode"
  docker-compose up -d node1
  echo -n "Waiting for eth1 rpc"
  while ! curl -X POST -H "$HEADERS" -sfL0 -o /dev/null --data "$REQ_BODY" "$RPC_ENDPOINT"; do
    sleep 2 && echo -n .
  done
  echo
  echo "Starting local IPFS"
  docker-compose up -d ipfs
  echo -n "Waiting for IPFS start"
  while ! curl --output /dev/null -s -f -L http://localhost:8080/api/v0/version; do
    sleep 2 && echo -n .
  done
  echo


  echo "Deploying Lido E2E env"
  # yarn deploy:e2e:all
  yarn compile
  # echo "Generating mock accounts"
  # node ./scripts/gen-accounts.js $RPC_ENDPOINT 50 $DEVCHAIN_DIR "$MOCK_VALIDATOR_MNEMONIC" $PASSWORD
  yarn deploy:e2e:aragon-env

  STAGE_DIR="stage0"
  if [ $MAKE_SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/$STAGE_DIR ]; then
    echo "Take snapshots for $STAGE_DIR"
    mkdir -p $SNAPSHOTS_DIR/$STAGE_DIR
    docker-compose stop node1
    cd $DATA_DIR
    echo "Take snapshots for devchain"
    zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/devchain.zip devchain
    cd - > /dev/null
    docker-compose start node1
    echo "Take snapshots of deployed.json"
    node ./scripts/deployed-backup.js $NETWORK_ID $SNAPSHOTS_DIR/$STAGE_DIR
  fi

  yarn deploy:e2e:aragon-std-apps
  # node ./scripts/gen-accounts.js $RPC_ENDPOINT 1 $DEVCHAIN_DIR "$MOCK_VALIDATOR_MNEMONIC" $PASSWORD
  yarn deploy:e2e:apm-and-template
  yarn deploy:e2e:apps
  # node ./scripts/gen-accounts.js $RPC_ENDPOINT 1 $DEVCHAIN_DIR "$MOCK_VALIDATOR_MNEMONIC" $PASSWORD
  yarn deploy:e2e:dao

  STAGE_DIR="stage1"
  if [ $MAKE_SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/$STAGE_DIR ]; then
    echo "Take snapshots for $STAGE_DIR"
    mkdir -p $SNAPSHOTS_DIR/$STAGE_DIR
    docker-compose stop node1
    docker-compose stop ipfs
    cd $DATA_DIR
    echo "Take snapshots for devchain"
    zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/devchain.zip devchain
    echo "Take snapshots for ipfs"
    zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/ipfs.zip ipfs
    cd - > /dev/null
    docker-compose start node1
    docker-compose start ipfs
    echo "Take snapshots of deployed.json"
    node ./scripts/deployed-backup.js $NETWORK_ID $SNAPSHOTS_DIR/$STAGE_DIR
  fi

  # wait a bit for block mining
  sleep 3
fi

if [ ! -d $IPFS_DIR ] && [ $SNAPSHOT ] && [ $WEB_UI ]; then
  echo "Unzip ipfs snapshot"
  # always use stage0 snapshot
  unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/stage1/ipfs.zip
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
if [ $ETH1_ONLY ]; then
  BLOCK_TIME=0 docker-compose up -d node1
  echo "ETH1 part done!"
  exit 0
else
  docker-compose up -d node1
fi

if [ ! -d $VALIDATORS_DIR ] && [ $SNAPSHOT ]; then
  echo "Unzip validators snapshot"
  unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/stage2/validators.zip
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

if [ ! -d $TESTNET_DIR ]; then
  if [ $SNAPSHOT ]; then
    echo "Unzip testnet snapshot"
    # always use stage1 snapshot
    unzip -o -q -d $DATA_DIR $SNAPSHOTS_DIR/stage2/testnet.zip
  else
    ETH2_RESET=true
  fi
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
    DEPOSIT=$(cat $DEPLOYED_FILE | jq -r ".networks[\"$NETWORK_ID\"].depositContractAddress")
    DEPOSIT_HEX=$(echo $DEPOSIT | cut -c 3-)

    docker-compose run --rm --no-deps lh lcli \
      --spec "$SPEC" \
      new-testnet --force \
      --deposit-contract-address "$DEPOSIT_HEX" \
      --deposit-contract-deploy-block "10" \
      --testnet-dir "/data/testnet" \
      --min-genesis-active-validator-count "$MOCK_VALIDATOR_COUNT" \
      --eth1-follow-distance "$ETH1_FOLLOW_DISTANCE" \
      --genesis-delay "$GENESIS_DELAY" \
      --genesis-fork-version "$FORK_VERSION"


    if [ $SPEC = "minimal" ]; then
      NOW=$(date +%s)
      echo "Reset genesis time to now ($NOW)"

      # reduce slot time generation
      sed -i 's/SECONDS_PER_SLOT: "6"/SECONDS_PER_SLOT: "1"/' $TESTNET_DIR/config.yaml
      # set according eth1 block time generation, see docker-compose.yml
      sed -i 's/SECONDS_PER_ETH1_BLOCK: "14"/SECONDS_PER_ETH1_BLOCK: "5"/' $TESTNET_DIR/config.yaml
      # sed -i "s/MIN_GENESIS_TIME: \"1578009600\"/MIN_GENESIS_TIME: \"$NOW\"/" $TESTNET_DIR/config.yaml
      sed -i "s/DEPOSIT_CHAIN_ID: \"5\"/DEPOSIT_CHAIN_ID: \"1337\"/" $TESTNET_DIR/config.yaml
      sed -i "s/DEPOSIT_NETWORK_ID: \"5\"/DEPOSIT_NETWORK_ID: \"$NETWORK_ID\"/" $TESTNET_DIR/config.yaml
      # fix deposit contract address
      sed -i "s/0x1234567890123456789012345678901234567890/$DEPOSIT/" $TESTNET_DIR/config.yaml
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

STAGE_DIR="stage2"
if [ $MAKE_SNAPSHOT ] && [ ! $SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/$STAGE_DIR ]; then
  echo "Take snapshots for $STAGE_DIR"
  mkdir -p $SNAPSHOTS_DIR/$STAGE_DIR
  docker-compose stop node1
  cd $DATA_DIR
  echo "Take snapshots for devchain"
  zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/devchain.zip devchain
  echo "Take snapshots for testnet"
  zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/testnet.zip testnet
  echo "Take snapshots for validators"
  zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/validators.zip validators
  cd - > /dev/null
  docker-compose start node1
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
if [ $ORACLES ]; then
  echo "Building oracle container"
  ./oracle_build.sh
  if [ $SEED ]; then
    $NODE scripts/mock_validators.js
  fi
  # STAGE_DIR="stage3"
  # if [ $MAKE_SNAPSHOT ] && [ ! $SNAPSHOT ] && [ ! -d $SNAPSHOTS_DIR/$STAGE_DIR ]; then
  #   echo "Take snapshots for $STAGE_DIR"
  #   mkdir -p $SNAPSHOTS_DIR/$STAGE_DIR
  #   docker-compose stop node1
  #   cd $DATA_DIR
  #   echo "Take snapshots for devchain"
  #   zip -rqu $SNAPSHOTS_DIR/$STAGE_DIR/devchain.zip devchain
  #   cd - > /dev/null
  #   docker-compose start node1
  # fi
  LIDO=$(cat $DEPLOYED_FILE | jq -r ".networks[\"$NETWORK_ID\"].appProxies[\"lido.lido.eth\"]")
  POOL_CONTRACT=$LIDO docker-compose up -d oracle-1 oracle-2 oracle-3
fi

if [ $NODES ]; then
  echo "Start extra nodes"
  docker-compose up -d node2-3 node2-4
fi

echo "All done!"
