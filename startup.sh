#!/bin/bash
source ./.env
set -e +u
set -o pipefail

ROOT=${PWD}
LOCAL_DATA_DIR="${PWD}${DATADIR}"
LOCAL_WALLETS_DIR="${PWD}${WALLETS_DIR}"
LOCAL_VALIDATORS_DIR="${PWD}${VALIDATORS_DIR}"
LOCAL_TESTNET_DIR="${PWD}${TESTNET_DIR}"

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
      echo "  -r2 | --reset2        force reset ETH2 blockchain state"
      echo "  -n | --nodes          start 2nd and 3d eth2 nodes"
      echo "  -s | --snapshot       use snapshot instead deploy"
      echo "  -1 | --eth1           start only eth1 node"
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
    -r2|--reset2)
      ETH2_RESET=true
      shift
      ;;
    -d|--dao)
      DAO_DEPLOY=true
      shift
      ;;
    *)
      break
      ;;
  esac
done

if [[ $RESET ]]; then
  echo "Cleanup"
  docker-compose down -v --remove-orphans
  rm -rf $LOCAL_DATA_DIR
  mkdir -p $LOCAL_DATA_DIR
  if [[ $SNAPSHOT ]]; then
    echo "Unzip ganache snapshot"
    unzip -o -q -d $LOCAL_DATA_DIR ./devchain-dao-deposit.zip
  fi
  ETH2_RESET=true
  DAO_DEPLOY=true
fi

if [[ ! "$(ls -A $DATA_DIR)" ]]; then
  RESET=true
fi

echo "Starting IPFS"
docker-compose up -d ipfs
echo -n "Waiting for IPFS start"
while ! curl --output /dev/null -s -f -L http://localhost:8080/api/v0/version; do
  sleep 2 && echo -n .
done
echo " "

echo "Starting eth1 node"
docker-compose up -d node1
echo -n "Waiting for eth1 rpc"
R="0x"
while [[ "$R" != "0x60" ]];
do
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DEPOSIT'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  sleep 2 && echo -n .
done
echo " "
ADDR="$DEPOSIT"
BLOCK=70
echo "Deposit contract predeployed: 0x$DEPOSIT at block $BLOCK"

# !! already deployed inside snapshot
if [[ ! $SNAPSHOT ]] && [[ $DAO_DEPLOY ]] ; then
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$APM'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DePool APM..."
    npm run deploy:apm:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DEPOOL_APP'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DePool Apps..."
    npm run deploy:apps:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$TEMPLATE'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DePool DAO template..."
    npm run deploy:tmpl:dev
  fi
  R=$(curl -s -f -L -X POST http://localhost:8545 --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x'$DAO'","latest"],"id":1}' | jq -r '.result'  | cut -c -4)
  if [[ "$R" != "0x60" ]]; then
    echo "Deploying DePool DAO..."
    npm run deploy:dao:dev
  fi
  # wait a bit for block mining
  sleep 3
else
  echo "DAO deployed at: 0x$DAO"
fi

if [[ $ETH1_ONLY ]]; then
  exit 0
fi

if [ $ETH2_RESET ]; then
  docker-compose run --rm --no-deps node2-1 lcli \
    --spec "$SPEC" \
    new-testnet \
    --deposit-contract-address "$ADDR" \
    --deposit-contract-deploy-block "$BLOCK" \
    --testnet-dir "$TESTNET_DIR" \
    --force \
    --min-genesis-active-validator-count "$VALIDATOR_COUNT" \
    --eth1-follow-distance "$ETH1_FOLLOW_DISTANCE" \
    --genesis-delay "$GENESIS_DELAY" \
    --genesis-fork-version "$FORK_VERSION"

  # overwrite some params in config
  #cp -f ./config.yaml $LOCAL_TESTNET_DIR

  if [ $SPEC = "minimal" ]; then
    # reduce slot time generation
    sed -i 's/SECONDS_PER_SLOT: 6/SECONDS_PER_SLOT: 1/' $LOCAL_TESTNET_DIR/config.yaml
    # set according eth1 block time generation, see docker-compose.yml
    sed -i 's/SECONDS_PER_ETH1_BLOCK: 14/SECONDS_PER_ETH1_BLOCK: 2/' $LOCAL_TESTNET_DIR/config.yaml
  fi

  echo "Specification generated at $LOCAL_TESTNET_DIR."

  echo "Generating $VALIDATOR_COUNT genesis validators concurrently... (this may take a while)"
  if [ ! -d "$LOCAL_WALLETS_DIR" ]; then
    docker-compose run --rm --no-deps node2-1 lighthouse \
      --spec "$SPEC" \
      --debug-level "$DEBUG_LEVEL" \
      account \
      wallet \
      --base-dir "$WALLETS_DIR" \
      create \
      --datadir "$DATADIR" \
      --name "$WALLET_NAME" \
      --password-file "$WALLET_PASSFILE" \
      --mnemonic-output-path "$WALLET_MNEMONIC" \
      --testnet-dir "$TESTNET_DIR"
  else
    echo "Wallet directory already exists. Skip accounts creating and deposit"
  fi

  # will skip extra accs creation if already some exists
  docker-compose run --rm --no-deps node2-1 lighthouse \
    --spec "$SPEC" \
    --debug-level "$DEBUG_LEVEL" \
    account \
    validator \
    --base-dir "$WALLETS_DIR" \
    create \
    --secrets-dir "$SECRETS_DIR" \
    --validator-dir "$VALIDATORS_DIR" \
    --wallet-name "$WALLET_NAME" \
    --wallet-password "$WALLET_PASSFILE" \
    --at-most "$VALIDATOR_COUNT" \
    --testnet-dir "$TESTNET_DIR"


  echo "Making deposits for $VALIDATOR_COUNT genesis validators... (this may take a while)"
  for D in $(find "$LOCAL_VALIDATORS_DIR" -type d -mindepth 1 -maxdepth 1); do
    R=$(curl -s -L -X POST http://localhost:8545 \
      --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{
      \"from\": \"$ADMIN\",
      \"to\": \"$ADDR\",
      \"gas\": \"0x1ac778\",
      \"gasPrice\": \"0x9184e72a000\",
      \"value\": \"0x1bc16d674ec800000\",
      \"data\": \"$(cat $D/eth1-deposit-data.rlp)\"
      }],\"id\":1}" | jq -r '.result')
    # R=$(node cmd-deposit.js "$ADDR" "$(cat $D/eth1-deposit-data.rlp)" | jq -r '.hash')
    echo "Deposit tx send, hash: $R"
    sleep 3
  done

  echo "Generating genesis"
  docker-compose run --rm --no-deps node2-1 lcli \
    --spec "$SPEC" \
    eth1-genesis \
    --testnet-dir "$TESTNET_DIR" \
    --eth1-endpoint http://node1:8545

  NOW=$(date +%s)
  echo "Reset genesis time to now ($NOW)"
  docker-compose run --rm --no-deps node2-1 lcli \
    --spec "$SPEC" \
    change-genesis-time \
    $TESTNET_DIR/genesis.ssz \
    $NOW
fi

if [[ $ETH1_ONLY ]]; then
  exit 0
fi

docker-compose up -d node2-1
# sleep 3
# #docker-compose up -d mock-validators
docker-compose up -d validators

if [[ $NODES ]]; then
  echo "Start extra nodes"
  sleep 3
  docker-compose up -d node2-2
  sleep 3
  docker-compose up -d node2-3
fi
