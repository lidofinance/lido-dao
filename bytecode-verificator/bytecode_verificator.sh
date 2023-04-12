#!/bin/sh
# Defaults
local_rpc_port=7776
local_rpc_url=http://localhost:$local_rpc_port

platform=$(uname | awk '{print tolower($0)}')

get_code() {
    curl -sS -X POST -H "Content-Type: application/json" $1 --data "{\"jsonrpc\": \"2.0\", \"id\": 42, \"method\": \"eth_getCode\", \"params\": [\"$2\", \"latest\"]}" | jq -r '.result'
}

get_code_etherscan() {
    curl -sS -G -d "address=$1" -d "action=eth_getCode" -d "module=proxy" -d "tag=latest" -d "apikey=$ETHERSCAN_TOKEN" https://api.etherscan.io/api | jq -r '.result'
}

get_account() {
    curl -sS -X POST -H "Content-Type: application/json" $1 --data '{"jsonrpc": "2.0", "id": 42, "method": "eth_accounts", "params": []}' | jq -r '.result[0]'
}

deploy_contract() {
    tx_hash=$(curl -sS -X POST $1 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$2\", \"to\":null,  \"gas\": \"0x1312D00\",  \"data\":\"$3\"}], \"id\":1}" -H 'Content-Type: application/json' | jq -r '.result')

    contract_address=$(curl -sS -X POST -H "Content-Type: application/json" $1 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$tx_hash\"],\"id\":1}" | jq -r '.result.contractAddress')

    echo $contract_address
}

read_contract_config() {
    cat $config_json | jq -r ".$1.$2"
}

fork_pid=0

local_fork_command="npx ganache --chain.vmErrorsOnRPCResponse true --wallet.totalAccounts 10 --chain.chainId 1 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000  --server.port $local_rpc_port --hardfork istanbul -d"

function start_fork() {
    echo "Starting local fork"
    (nc -vz 127.0.0.1 $local_rpc_port) &>/dev/null && kill -9 $(lsof -t -i:$local_rpc_port)
    $local_fork_command 1> ./logs 2>& 1 &
    fork_pid=$$
    echo "pid $fork_pid"
    sleep 8
}

function ctrl_c() {
    if [[ $fork_pid > 0 ]]
    then
        echo "Stopping ganache"
        kill -9 $fork_pid
    fi
    exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --solc-version)
      solc_version="$2"
      shift
      shift
      ;;
    --remote-rpc)
      remote_rpc_url="$2"
      shift
      shift
      ;;
    --contract)
      contract="$2"
      shift
      shift
      ;;
    --config-json)
      config_json="$2"
      shift
      shift
      ;;
    --constructor-calldata)
      constructor_calldata="$2"
      shift
      shift
      ;;
    -*|--*)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo >&2 "jq is required but it's not installed. Aborting."; exit 1; }

[[ -z "$WEB3_INFURA_PROJECT_ID" ]] && { echo "WEB3_INFURA_PROJECT_ID is required but is not set. Aborting."; exit 1; }
[[ -z "$ETHERSCAN_TOKEN" ]] && { echo "ETHERSCAN_TOKEN is required but is not set. Aborting."; exit 1; }

sha256sum='sha256sum'
if [[ $platform == 'darwin' ]]; then
   sha256sum='shasum -a 256'
fi

solc=./compilers/solc-$platform-$solc_version

echo "Compiler vesion $solc_version"
echo "Compiler binary $solc"
echo "Checking compiler binary"

test -f $solc || { echo "compiler $solc isn't exists. Aborting"; exit 1; }
compilerSha256Sum=$($sha256sum $solc)
echo $compilerSha256Sum
grep -q $compilerSha256Sum ./SHA256SUMS || { echo "$solc has unrecognized checksum (local). Aborting"; exit 1; }

if [[ $platform == 'darwin' ]]; then
   github_sha256=$(curl -sS https://binaries.soliditylang.org/macosx-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
   [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]] || { echo "$solc has unrecognized checksum (github). Aborting"; exit 1; }
elif [[ $platform == 'linux' ]]; then
   github_sha256=$(curl -sS https://binaries.soliditylang.org/linux-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
   [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]]  || { echo "$solc has unrecognized checksum (github). Aborting"; exit 1; }
fi

start_fork

contract_config_name=$(read_contract_config $contract contract)
contract_config_address=$(read_contract_config $contract address)
echo "Contract name: $contract_config_name"
echo "Contract address: $contract_config_address"

echo "Compiling contracts"
rm -rf ./build
cd ..
./bytecode-verificator/$solc @openzeppelin/contracts-v4.4=./node_modules/@openzeppelin/contracts-v4.4 contracts/$solc_version/**/*.sol contracts/$solc_version/*.sol  -o ./bytecode-verificator/build --bin --overwrite --optimize --optimize-runs 200 --evm-version istanbul  1> ./logs 2>& 1
cd ./bytecode-verificator

if [[ -z "$constructor_calldata" ]]; then
    #  read -r -a Words <<< $(read_contract_config $contract constructorArgs)
    constructor_config_args=$(read_contract_config $contract constructorArgs | sed -e 's/[\"[]//g' | tr ", " "\n")
    constructor_calldata=""
    for arg in $constructor_config_args; do
        if [[ ${#arg} == 42 ]]; then
            constructor_calldata="$constructor_calldata$(echo $arg | sed -e 's/0x/000000000000000000000000/')"
        elif [[ $arg =~ ^[0-9]+$ ]]; then
            constructor_calldata="$constructor_calldata$(printf "%064X\n" $arg)"
        fi
    done
fi

echo "Contract constructor encoded args: 0x$constructor_calldata"

echo "Deploying compiled contract to local fork"
contract_bytecode=$(cat ./build/$contract_config_name.bin)
deployment_bytecode="0x$contract_bytecode$constructor_calldata"
deployer_account=$(get_account $local_rpc_url 0)
local_contract_address=$(deploy_contract $local_rpc_url $deployer_account $deployment_bytecode)

echo "Retrieving contract bytecode from local rpc"
local_code=$(get_code $local_rpc_url $local_contract_address)

echo "Retrieving contract bytecode from remote rpc"
remote_code=$(get_code $remote_rpc_url $contract_config_address)

echo "Retrieving contract bytecode from etherscan"
etherscan_code=$(get_code_etherscan $contract_config_address)

echo "Replacing CBOR-encoded metadata"
# https://docs.soliditylang.org/en/v0.8.9/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode

remote_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$remote_code")
local_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$local_code")
etherscan_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$etherscan_code")

echo "Comparing remote and local bytecode"
[[ $local_code == $remote_code ]] ||  { echo "local bytecode and remote bytecode is not equal. Aborting"; exit 1; }
echo "Local bytecode matches with remote rpc"

echo "Comparing etherscan and local bytecode"
[[ $local_code == $etherscan_code ]] ||  { echo "local bytecode and etherscan bytecode is not equal. Aborting"; exit 1; }
echo "Local bytecode matches with etherscan"

echo "Stopping ganache"
kill -9 $fork_pid
