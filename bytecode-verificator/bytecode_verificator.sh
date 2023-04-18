#!/bin/sh

################################
# Bytecode verification script #
################################

RED='\033[0;31m'
ORANGE='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

zero_padding=$(printf '%0.1s' "0"{1..64})
placeholder_padding=$(printf '%0.1s' "-"{1..64})

# Prerequisite executables
prerequisites=(jq yarn awk curl shasum uname)

# Environment vailable required
envs=(WEB3_INFURA_PROJECT_ID ETHERSCAN_TOKEN)

# Commandline args required
cmdargs=(solc_version remote_rpc_url contract config_json)

function show_help() {
    echo -e "$ORANGE Usage: $NC $0"\
      "--solc-version 0.x.y" \
      "--remote-rpc https://*" \
      "--config-json ../deployed-*.json" \
      "--contract Name" \
      "[--constructor-calldata *]"\
      "[--proxy]"\
      "[--implementation]"
}

# Fork PID of Ganache
fork_pid=0

# Entry point
main() {
  check_prerequisites
  check_envs

  parse_cmd_args "$@"
  check_compiler
  start_fork

  compile_contract
  deploy_contract_on_fork
  compare_bytecode
}

# Service functions

function check_prerequisites() {
  for p in "${prerequisites[@]}"
  do
    if ! [ -x "$(command -v $p)" ]; then
      _err "$p app is required but not found"
    fi
  done
}

function check_envs() {
  for e in "${envs[@]}"
  do
    if [[ -z "${!e}" ]]; then
      _err "${e} env var is required but is not set"
    fi
  done
}

function parse_cmd_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --solc-version)
        solc_version="$2"
        shift
        shift
        ;;
      --remote-rpc-url)
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
      --proxy)
        is_proxy=true
        shift
        ;;
      --implementation)
        is_implementation=true
        shift
        ;;
      --help)
        show_help
        exit 0
        ;;
      -*|--*)
        _err "Unknown option "$1""
        ;;
    esac
  done

  for arg in "${cmdargs[@]}"
  do
    if [ -z "${!arg}" ]; then
      _err "argument '--${arg//_/-}' is empty"
    fi
  done
}

function check_compiler() {
  platform=$(uname | awk '{print tolower($0)}')
  sha256sum='sha256sum'
  if [[ $platform == 'darwin' ]] || [[ $platform == 'linux' ]]; then
    sha256sum='shasum -a 256'
  else
    _err "unknown platform: $platform"
  fi

  solc=./compilers/solc-$platform-$solc_version

  if ! [ -x "$(command -v $solc)" ]; then
    _err "$solc is not executable"
  fi

  echo -e "Platform: ${ORANGE}$platform${NC}"
  echo -e "Compiler vesion: ${ORANGE}$solc_version${NC}"
  echo -e "Compiler binary: ${ORANGE}$solc${NC}"

  test -f $solc || { _err "compiler $solc isn't exist"; }
  compilerSha256Sum=$($sha256sum $solc)
  grep -q $compilerSha256Sum ./SHA256SUMS || { _err "$solc has unrecognized checksum (local)"; }

  if [[ $platform == 'darwin' ]]; then
    github_sha256=$(curl -sS https://binaries.soliditylang.org/macosx-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
    [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]] || { _err "$solc has unrecognized checksum (github)"; }
  elif [[ $platform == 'linux' ]]; then
    github_sha256=$(curl -sS https://binaries.soliditylang.org/linux-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
    [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]]  || { _err "$solc has unrecognized checksum (github)"; }
  fi

  checksum=`echo -e "$compilerSha256Sum" | awk '{print $1;}'`
  echo -e "Compiler checksum ${ORANGE}$checksum${GREEN} is correct${NC}"
}

function start_fork() {
  local_rpc_port=7776
  local_rpc_url=http://localhost:$local_rpc_port
  local_fork_command="yarn ganache --chain.vmErrorsOnRPCResponse true --wallet.totalAccounts 10 --chain.chainId 1 --fork.url https://mainnet.infura.io/v3/$WEB3_INFURA_PROJECT_ID --miner.blockGasLimit 92000000  --server.port $local_rpc_port --hardfork istanbul -d"

  echo "Starting local fork"
  (nc -vz 127.0.0.1 $local_rpc_port) &>/dev/null && kill -15 $(lsof -t -i:$local_rpc_port)

  $local_fork_command 1> ./logs 2>& 1 &
  fork_pid=$$
  echo "Ganache pid $fork_pid"

  sleep 10
}

function encode_address() {
  echo $(sed -e 's/0x/000000000000000000000000/' <<< $1)
}

function encode_uint256() {
  printf "%064X\n" $1
}

function encode_bytes32() {
  echo $(sed -e 's/0x//' <<< $1)
}

function encode_bytes() {
  local bytes_str=$(sed -E 's/^0x(00)*//' <<< $1)
  local data_length=$(expr ${#bytes_str} / 2)
  local encoded_length=0
  if [[ data_length -gt "0" ]]; then
    encoded_length=$(expr $(expr $(expr $(expr ${#bytes_str} - 1) / 64) + 1) \* 64)
  fi
  bytes_str=$bytes_str$zero_padding
  bytes_str=${bytes_str:0:$encoded_length}
  echo "$(printf "%064X\n" $data_length)$bytes_str"
}

function encode_string() {
  local string_bytes=$(xxd -p <<< "$1" | sed 's/..$//')
  local data_length=$(expr ${#string_bytes} / 2)
  local encoded_length=0
  if [[ data_length -gt "0" ]]; then
    encoded_length=$(expr $(expr $(expr $(expr ${#string_bytes} - 1) / 64) + 1) \* 64)
  fi
  string_bytes=$string_bytes$zero_padding
  string_bytes=${string_bytes:0:$encoded_length}
  echo "$(printf "%064X\n" $data_length)$string_bytes"
}

function encode_array() {
  local types=$1
  local array=$2

  local array_length=$(jq -r 'length' <<< $array)
  local encoded_data="$encoded_data$(encode_uint256 $(expr $array_length \* 32))"
  if [[ $array_length -gt 0 ]]; then
    for i in $(seq 0 $(expr $array_length - 1) ); do
      case $type in
        address\[\]) encoded_data="$encoded_data$(encode_address $(jq -r ".[$i]" <<< $array))" ;;
        uint256\[\]) encoded_data="$encoded_data$(encode_uint256 $(jq -r ".[$i]" <<< $array))" ;;
        bytes32\[\]) encoded_data="$encoded_data$(encode_bytes32 $(jq -r ".[$i]" <<< $array))" ;;
        *) _err "Unknown constructor argument type '$1', use --constructor-calldata instead" ;;
      esac
    done
  fi
  echo $encoded_data
}

function encode_tuple() {
  local types=$1
  local args=$2
  local args_length=$(jq -r 'length' <<< $types)

  for arg_index in $(seq 0 $(expr $args_length - 1) ); do
    local arg_type=$(jq -r ".[$arg_index]" <<< $types)
    local arg=$(jq -r ".[$arg_index]" <<< $args)

    case $arg_type in
      address) encoded_data="$encoded_data$(encode_address $arg)" ;;
      uint256) encoded_data="$encoded_data$(encode_uint256 $arg)" ;;
      bytes32) encoded_data="$encoded_data$(encode_bytes32 $arg)" ;;
      *) _err "Unknown constructor argument type '$arg_type', use --constructor-calldata instead" ;;
    esac
  done
  echo $encoded_data
}

function endode_placeholder() {
  local placeholder="$1$placeholder_padding"
  echo ${placeholder:0:64}
}


function compile_contract() {
  if [[ $is_proxy ]]; then
    contract_config_name=OssifiableProxy
    contract_config_address=$(_read_contract_config $contract address)
  elif [[ $is_implementation ]]; then
    contract_config_name=$(_read_contract_config "$contract" contract)
    contract_config_address=$(_read_contract_config $contract implementation)
  else
    contract_config_name=$(_read_contract_config $contract contract)
    contract_config_address=$(_read_contract_config $contract address)
  fi

  echo -e "Contract name: ${ORANGE}$contract_config_name${NC}"
  echo -e "Contract address: ${ORANGE}$contract_config_address${NC}"

  if [[ "$solc_version" == "0.8.9" ]]; then
    rm -rf ./build
    cd ..
    ./bytecode-verificator/$solc @openzeppelin/contracts-v4.4=./node_modules/@openzeppelin/contracts-v4.4 contracts/$solc_version/**/*.sol contracts/$solc_version/*.sol -o ./bytecode-verificator/build --bin --overwrite --optimize --optimize-runs 200 1> ./logs 2>& 1
    ./bytecode-verificator/$solc @openzeppelin/contracts-v4.4=./node_modules/@openzeppelin/contracts-v4.4 contracts/$solc_version/**/*.sol contracts/$solc_version/*.sol -o ./bytecode-verificator/build --abi --overwrite --optimize --optimize-runs 200 1> ./logs 2>& 1
    cd ./bytecode-verificator
  elif [[ "$solc_version" == "0.4.24" ]]; then
    rm -rf ./build
    cd ..
    ./bytecode-verificator/./compilers/solc-darwin-0.4.24 @aragon=./node_modules/@aragon openzeppelin-solidity/contracts=./node_modules/openzeppelin-solidity/contracts contracts/$solc_version/**/*.sol contracts/$solc_version/*.sol --allow-paths $(pwd) -o ./bytecode-verificator/build --bin --overwrite --optimize --optimize-runs 200 --evm-version constantinople 1> ./logs 2>& 1
    ./bytecode-verificator/./compilers/solc-darwin-0.4.24 @aragon=./node_modules/@aragon openzeppelin-solidity/contracts=./node_modules/openzeppelin-solidity/contracts contracts/$solc_version/**/*.sol contracts/$solc_version/*.sol --allow-paths $(pwd) -o ./bytecode-verificator/build --abi --overwrite --optimize --optimize-runs 200 --evm-version constantinople 1> ./logs 2>& 1
    cd ./bytecode-verificator
  else
    _err "Unknown solidity version '$solc_version'"
  fi

  if [[ -z "$constructor_calldata" ]]; then
    local contract_abi=$(cat ./build/$contract_config_name.abi)
    local constructor_abi=$(jq -r '.[] | select(.type == "constructor") | .inputs ' <<< $contract_abi)
    local arg_length=$(jq -r 'length' <<< $constructor_abi)

    echo -e "Constructor args: $(jq ".[].type" <<< $constructor_abi)"

    if [[ $is_proxy ]]; then
      constructor_config_args=$(_read_contract_config $contract proxyConstructorArgs)
    else
      constructor_config_args=$(_read_contract_config $contract constructorArgs)
    fi

    if [[ $arg_length -gt 0 ]]; then
      compl_data=()
      for argument_index in $(seq 0 $(expr $arg_length - 1) ); do
        arg_type=$(jq -r ".[$argument_index].type" <<< $constructor_abi)
        arg=$(jq -r ".[$argument_index]" <<< $constructor_config_args)
        case $arg_type in
          address) constructor_calldata="$constructor_calldata$(encode_address $arg)" ;;
          uint256) constructor_calldata="$constructor_calldata$(encode_uint256 $arg)" ;;
          bytes32) constructor_calldata="$constructor_calldata$(encode_bytes32 $arg)" ;;
          bytes)
            constructor_calldata="$constructor_calldata$(endode_placeholder ${#compl_data[@]})"
            compl_data+=$(encode_bytes $arg)
            ;;
          string)
            constructor_calldata="$constructor_calldata$(endode_placeholder ${#compl_data[@]})"
            compl_data+=($(encode_string "$arg"))
            ;;
          tuple)
            args_types=$(jq -r ".[$argument_index].components | map(.type)" <<< $constructor_abi)
            constructor_calldata="$constructor_calldata$(encode_tuple "$args_types" "$arg")"
            ;;
          *[])
            constructor_calldata="$constructor_calldata$(endode_placeholder ${#compl_data[@]})"
            compl_data+=$(encode_array $arg_type "$arg")
            ;;
          *) _err "Unknown constructor argument type '$arg_type', use --constructor-calldata instead" ;;
        esac
      done

      for index in "${!compl_data[@]}"; do
        encoded_data_length=$(expr ${#constructor_calldata} / 2)
        constructor_calldata=$(sed -E "s/$(endode_placeholder $index)/$(printf "%064X\n" $encoded_data_length)/" <<< "$constructor_calldata${compl_data[$index]}")
      done
    fi
  fi

  echo "Contract constructor encoded args: 0x$constructor_calldata"
}

function deploy_contract_on_fork() {
  echo "Deploying compiled contract to local fork"
  contract_bytecode=$(cat ./build/$contract_config_name.bin)
  deployment_bytecode="0x$contract_bytecode$constructor_calldata"
  deployer_account=$(_get_account $local_rpc_url 0)
  local_contract_address=$(_deploy_contract $local_rpc_url $deployer_account $deployment_bytecode)
}

function compare_bytecode() {
  echo "Retrieving contract bytecode from local rpc (Ganache)"
  local_code=$(_get_code $local_rpc_url $local_contract_address)

  echo -e "Retrieving contract bytecode from remote rpc ${remote_rpc_url}"
  remote_code=$(_get_code $remote_rpc_url $contract_config_address)

  echo "Retrieving contract bytecode from etherscan"
  etherscan_code=$(_get_code_etherscan $contract_config_address)

  echo "Replacing CBOR-encoded metadata"
  # https://docs.soliditylang.org/en/v0.8.9/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode
  remote_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$remote_code")
  local_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$local_code")
  etherscan_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<< "$etherscan_code")

  # https://docs.soliditylang.org/en/v0.4.24/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode
  remote_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<< "$remote_code")
  local_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<< "$local_code")
  etherscan_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<< "$etherscan_code")

  _print_checksum local_code
  _print_checksum remote_code
  _print_checksum etherscan_code

  echo "Comparing remote and local bytecode"
  [[ $local_code == $remote_code ]] ||  { _err "local bytecode and remote bytecode is not equal"; }
  echo -e "${GREEN}Local bytecode matches with remote rpc${NC}"

  echo "Comparing etherscan and local bytecode"
  [[ $local_code == $etherscan_code ]] ||  { _err "local bytecode and etherscan bytecode is not equal"; }
  echo -e "${GREEN}Local bytecode matches with etherscan${NC}"
}

# Internals

_get_code() {
    curl -sS -X POST -H "Content-Type: application/json" $1 --data "{\"jsonrpc\": \"2.0\", \"id\": 42, \"method\": \"eth_getCode\", \"params\": [\"$2\", \"latest\"]}" | jq -r '.result'
}

_get_code_etherscan() {
    curl -sS -G -d "address=$1" -d "action=eth_getCode" -d "module=proxy" -d "tag=latest" -d "apikey=$ETHERSCAN_TOKEN" https://api.etherscan.io/api | jq -r '.result'
}

_get_account() {
    curl -sS -X POST -H "Content-Type: application/json" $1 --data '{"jsonrpc": "2.0", "id": 42, "method": "eth_accounts", "params": []}' | jq -r '.result[0]'
}

_deploy_contract() {
    tx_hash=$(curl -sS -X POST $1 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$2\", \"to\":null,  \"gas\": \"0x1312D00\",  \"data\":\"$3\"}], \"id\":1}" -H 'Content-Type: application/json' | jq -r '.result')

    contract_address=$(curl -sS -X POST -H "Content-Type: application/json" $1 --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$tx_hash\"],\"id\":1}" | jq -r '.result.contractAddress')

    echo $contract_address
}

_read_contract_config() {
    cat $config_json | jq -r ".\"$1\".\"$2\""
}

_print_checksum() {
  echo -e "${ORANGE}$1${NC} checksum: `echo ${!1} | shasum -a 256`"
}

_err() {
    echo -e "${RED}Error:${NC} $1, aborting."
    exit 1
}

# Intercept ctrl+C
trap ctrl_c INT
ctrl_c() {
    if [[ $fork_pid > 0 ]];
    then
        echo "Stopping ganache"
        kill -15 $fork_pid
    fi
    exit 0
}

# Run main
main "$@"; exit 0
