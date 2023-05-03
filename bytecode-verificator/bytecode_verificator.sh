#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

if [[ "${TRACE-0}" == "1" ]]; then
  set -o xtrace
fi

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
prerequisites=(jq yarn awk curl shasum uname bc nc)

# Environment vailable required
envs=(WEB3_INFURA_PROJECT_ID ETHERSCAN_TOKEN)

# Commandline args required
cmdargs=(solc_version remote_rpc_url contract config_json)
sha256sum='shasum -a 256'

# Vars
constructor_calldata=""
contract_config_name=""
local_rpc_url=""
# Fork PID of Ganache
fork_pid=0
local_rpc_port=7776
local_rpc_url=http://127.0.0.1:${local_rpc_port}

function show_help() {
  cat <<-_EOF_
  Bytecode verificator

  CLI tool to validate contract bytecode at remote rpc node, etherscan and bytecode deployed from local source code

  $0 [--solc-version <arg>] [--remote-rpc-url <arg>] [--contract <arg>] [--config-json <arg>] [--constructor-calldata <arg>] [--proxy] [--implementation] [-h|--help]

  Options:
  --solc-version SOLC-VERSION      version of solidity to compile contract with (e.g. 0.4.24, 0.8.9)
  --remote-rpc-url REMOTE-RPC-URL  Ethereum node URL that contains the comparating contract bytecode. e.g. https://mainnet.infura.io/v3/\$WEB3_INFURA_PROJECT_ID
  --contract CONTRACT              Contract name from config file. (e.g. app:lido, stakingRouter, lidoLocator ...)
  --config-json CONFIG-JSON        Path to JSON file. Artifacts of deployment (e.g './deployed-mainnet.json')
  --constructor-calldata DATA      (optional) Calldata that will be used for local contract deployment. Will be encoded from config file if does not provided. (hex data with no 0x prefix)
  --proxy                          (optional) Specifies contract as OssifiableProxy. Conflicts with '--implementation'. 'proxyConstructorArgs' from config will be used to encode constructor calldata if '--constructor-calldata' is not provided  [default: off].
  --implementation                 (optional) Specifies contract as OssifiableProxy. Conflicts with '--proxy'. 'constructorArgs' from config will be used to encode constructor calldata if '--constructor-calldata' is not provided  [default: off].
  -h, --help                       Prints help.
_EOF_
}

# Entry point
main() {
  SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
  cd "${SCRIPT_DIR}"

  check_root
  check_prerequisites
  check_envs

  parse_cmd_args "$@"
  check_compiler
  [[ "${local_ganache:-unset}" == "unset" ]] && start_fork

  [[ "${skip_compilation:-unset}" == "unset" ]] && compile_contract
  deploy_contract_on_fork
  compare_bytecode
}

# Service functions

function check_root() {
  if ((EUID == 0)); then
    _err "This script must NOT be run as root"
  fi
}

function check_prerequisites() {
  for p in "${prerequisites[@]}"; do
    [[ -x "$(command -v "$p")" ]] || { _err "$p app is required but not found"; }
  done
}

function check_envs() {
  for e in "${envs[@]}"; do
    [[ "${!e:+isset}" == "isset" ]] || { _err "${e} env var is required but is not set"; }
  done
}

function parse_cmd_args() {

  while [[ $# -gt 0 ]]; do
    case $1 in
    --solc-version)
      solc_version="$2"
      [[ "$solc_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { _err "Invalid solc version: $solc_version"; }
      shift
      shift
      ;;
    --remote-rpc-url)
      remote_rpc_url="$2"
      [[ "$remote_rpc_url" =~ ^http ]] || { _err "Invalid remote rpc URL: $remote_rpc_url"; }
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
      [[ -f $config_json ]] || { _err "config file ${config_json} does not exist"; }
      shift
      shift
      ;;
    --constructor-calldata)
      constructor_calldata="$2"
      [[ "$constructor_calldata" =~ ^[0-9A-Fa-f]+$ ]] || { _err "Invalid calldata: $constructor_calldata"; }
      shift
      shift
      ;;
    --proxy)
      is_proxy=true
      [[ "${is_implementation:+isset}" == "isset" ]] && { _err "-proxy and --implementation is not allowed to be used at one time"; }
      shift
      ;;
    --implementation)
      is_implementation=true
      [[ "${is_proxy:+isset}" == "isset" ]] && { _err "--proxy and --implementation is not allowed to be used at one time"; }
      shift
      ;;
    --skip-compilation)
      skip_compilation=true
      shift
      ;;
    --local-ganache)
      local_ganache=true
      shift
      ;;
    --help | -h)
      show_help
      exit 0
      ;;
    --* | -*)
      _err "Unknown option \"$1\""
      ;;
    esac
  done

  for arg in "${cmdargs[@]}"; do
    if [ "${!arg:+isset}" != "isset" ]; then
      _err "argument '--${arg//_/-}' is empty"
    fi
  done
}

function check_compiler() {
  platform=$(uname | awk '{print tolower($0)}')

  solc=./compilers/solc-$platform-$solc_version

  if ! [ -x "$(command -v "$solc")" ]; then
    _err "$solc could not be found or is not executable"
  fi

  echo -e "Platform: ${ORANGE}$platform${NC}"
  echo -e "Compiler version: ${ORANGE}$solc_version${NC}"
  echo -e "Compiler binary: ${ORANGE}$solc${NC}"

  compilerSha256Sum=$($sha256sum "$solc")
  grep -q "$compilerSha256Sum" ./SHA256SUMS || { _err "\"$solc\" has unrecognized checksum (local)"; }

  if [[ "$platform" == 'darwin' ]]; then
    github_sha256=$(curl -sS https://binaries.soliditylang.org/macosx-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
    [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]] || { _err "$solc has unrecognized checksum (github)"; }
  elif [[ $platform == 'linux' ]]; then
    github_sha256=$(curl -sS https://binaries.soliditylang.org/linux-amd64/list.json | jq -r ".builds | .[] | select(.version==\"$solc_version\").sha256")
    [[ "$github_sha256  $solc" == "0x$compilerSha256Sum" ]] || { _err "$solc has unrecognized checksum (github)"; }
  fi

  checksum=$(echo -e "$compilerSha256Sum" | awk '{print $1;}')
  echo -e "Compiler checksum ${ORANGE}$checksum${GREEN} is correct${NC}"
}

function start_fork() {
  local_fork_command=$(
    cat <<-_EOF_ | xargs | sed 's/ / /g'
    yarn ganache --chain.vmErrorsOnRPCResponse true
    --wallet.totalAccounts 10 --chain.chainId 1
    --fork.url https://mainnet.infura.io/v3/${WEB3_INFURA_PROJECT_ID}
    --miner.blockGasLimit 92000000
    --server.host 127.0.0.1 --server.port ${local_rpc_port}
    --hardfork istanbul -d
_EOF_
  )

  echo "Starting local fork \"${local_fork_command}\""
  (nc -vz 127.0.0.1 $local_rpc_port) &>/dev/null && kill -SIGTERM "$(lsof -t -i:$local_rpc_port)"

  $local_fork_command 1>>./logs 2>&1 &
  fork_pid=$$
  echo "Ganache pid $fork_pid"

  sleep 10
}

function encode_address() {
  echo "${1/0x/000000000000000000000000}"
}

function encode_uint256() {
  printf "%064X\n" "$1"
}

function encode_bytes32() {
  echo "${1/0x/}"
}

function encode_bytes() {
  local bytes_str
  local data_length
  local encoded_length

  bytes_str=$(sed -E 's/^0x(00)*//' <<<"$1")
  data_length=$((${#bytes_str} / 2))
  encoded_length=0
  if [[ data_length -gt "0" ]]; then
    encoded_length=$(bc <<<"(((${#bytes_str} - 1) / 64) + 1) * 64")
  fi
  bytes_str=$bytes_str$zero_padding
  bytes_str=${bytes_str:0:$encoded_length}
  echo "$(printf "%064X\n" "$data_length")$bytes_str"
}

function encode_string() {
  local string_bytes
  local data_length
  local encoded_length

  string_bytes=$(xxd -p <<<"$1" | sed 's/..$//')
  data_length=$(bc <<<"${#string_bytes} / 2")
  encoded_length=0
  if [[ data_length -gt "0" ]]; then
    encoded_length=$(bc <<<"(((${#string_bytes} - 1) / 64) + 1) * 64")
  fi
  string_bytes=$string_bytes$zero_padding
  string_bytes=${string_bytes:0:$encoded_length}
  echo "$(printf "%064X\n" "$data_length")$string_bytes"
}

function encode_array() {
  local type=$1
  local array=$2
  local array_length
  local encoded_data
  encoded_data=""

  array_length=$(jq -r 'length' <<<"$array")
  encoded_data="$encoded_data$(encode_uint256 "$(bc <<<"$array_length * 32")")"
  if [[ $array_length -gt 0 ]]; then
    for i in $(seq 0 "$(bc <<<"$array_length - 1")"); do
      case $type in
      address\[\]) encoded_data="$encoded_data$(encode_address "$(jq -r ".[$i]" <<<"$array")")" ;;
      uint256\[\]) encoded_data="$encoded_data$(encode_uint256 "$(jq -r ".[$i]" <<<"$array")")" ;;
      bytes32\[\]) encoded_data="$encoded_data$(encode_bytes32 "$(jq -r ".[$i]" <<<"$array")")" ;;
      *) _err "Unknown constructor argument type '$type', use --constructor-calldata instead" ;;
      esac
    done
  fi
  echo "$encoded_data"
}

function encode_tuple() {
  local types=$1
  local args=$2
  local args_length
  local encoded_data
  encoded_data=""

  args_length=$(jq -r 'length' <<<"$types")

  for arg_index in $(seq 0 "$(bc <<<"$args_length - 1")"); do
    local arg_type
    local arg

    arg_type=$(jq -r ".[$arg_index]" <<<"$types")
    arg=$(jq -r ".[$arg_index]" <<<"$args")

    case $arg_type in
    address) encoded_data="$encoded_data$(encode_address "$arg")" ;;
    uint256) encoded_data="$encoded_data$(encode_uint256 "$arg")" ;;
    bytes32) encoded_data="$encoded_data$(encode_bytes32 "$arg")" ;;
    *) _err "Unknown constructor argument type '$arg_type', use --constructor-calldata instead" ;;
    esac
  done
  echo "$encoded_data"
}

function endode_solidity_calldata_placeholder() {
  local placeholder="$1$placeholder_padding"
  echo "${placeholder:0:64}"
}

function compile_contract() {
  if [[ "$solc_version" == "0.8.9" ]]; then
    rm -rf "${PWD}/build"
    cd "${PWD}/.."
    ./bytecode-verificator/"$solc" @openzeppelin/contracts-v4.4=./node_modules/@openzeppelin/contracts-v4.4 contracts/"$solc_version"/**/*.sol contracts/"$solc_version"/*.sol -o ./bytecode-verificator/build --bin --overwrite --optimize --optimize-runs 200 1>>./logs 2>&1
    ./bytecode-verificator/"$solc" @openzeppelin/contracts-v4.4=./node_modules/@openzeppelin/contracts-v4.4 contracts/"$solc_version"/**/*.sol contracts/"$solc_version"/*.sol -o ./bytecode-verificator/build --abi --overwrite --optimize --optimize-runs 200 1>>./logs 2>&1
    cd - &>/dev/null
  elif [[ "$solc_version" == "0.4.24" ]]; then
    rm -rf "${PWD}/build"
    cd "${PWD}/.."
    ./bytecode-verificator/"$solc" @aragon=./node_modules/@aragon openzeppelin-solidity/contracts=./node_modules/openzeppelin-solidity/contracts contracts/"$solc_version"/**/*.sol contracts/"$solc_version"/*.sol --allow-paths "$(pwd)" -o ./bytecode-verificator/build --bin --overwrite --optimize --optimize-runs 200 --evm-version constantinople 1>>./logs 2>&1
    ./bytecode-verificator/"$solc" @aragon=./node_modules/@aragon openzeppelin-solidity/contracts=./node_modules/openzeppelin-solidity/contracts contracts/"$solc_version"/**/*.sol contracts/"$solc_version"/*.sol --allow-paths "$(pwd)" -o ./bytecode-verificator/build --abi --overwrite --optimize --optimize-runs 200 --evm-version constantinople 1>>./logs 2>&1
    cd - &>/dev/null
  else
    _err "Unknown solidity version '$solc_version'"
  fi
}

function deploy_contract_on_fork() {
  if [[ "${is_proxy:+isset}" == "isset" ]]; then
    contract_config_name=OssifiableProxy
    contract_config_address=$(_read_contract_config "$contract" address)
  elif [[ "${is_implementation:+isset}" == "isset" ]]; then
    contract_config_name=$(_read_contract_config "$contract" contract)
    contract_config_address=$(_read_contract_config "$contract" implementation)
  else
    contract_config_name=$(_read_contract_config "$contract" contract)
    contract_config_address=$(_read_contract_config "$contract" address)
  fi

  echo -e "Contract name: ${ORANGE}$contract_config_name${NC}"
  echo -e "Contract address: ${ORANGE}$contract_config_address${NC}"

  if [[ "${constructor_calldata:-unset}" == "unset" ]]; then
    local contract_abi
    local constructor_abi
    local arg_length
    local constructor_config_args
    local compl_data

    compl_data=()
    contract_abi=$(cat ./build/"$contract_config_name".abi)
    constructor_abi=$(jq -r '.[] | select(.type == "constructor") | .inputs ' <<<"$contract_abi")
    arg_length=$(jq -r 'length' <<<"$constructor_abi")

    echo -e "Constructor args types: $(jq ".[].type" <<<"$constructor_abi")"

    if [[ "${is_proxy:+isset}" == "isset" ]]; then
      constructor_config_args=$(_read_contract_config "$contract" proxyConstructorArgs)
    else
      constructor_config_args=$(_read_contract_config "$contract" constructorArgs)
    fi

    if [[ $arg_length -gt 0 ]]; then
      for argument_index in $(seq 0 "$(bc <<<"$arg_length - 1")"); do
        local arg_type
        local arg

        arg_type=$(jq -r ".[$argument_index].type" <<<"$constructor_abi")
        arg=$(jq -r ".[$argument_index]" <<<"$constructor_config_args")

        case $arg_type in
        address) constructor_calldata="$constructor_calldata$(encode_address "$arg")" ;;
        uint256) constructor_calldata="$constructor_calldata$(encode_uint256 "$arg")" ;;
        bytes32) constructor_calldata="$constructor_calldata$(encode_bytes32 "$arg")" ;;
        bytes)
          constructor_calldata="$constructor_calldata$(endode_solidity_calldata_placeholder ${#compl_data[@]})"
          compl_data+=("$(encode_bytes "$arg")")
          ;;
        string)
          constructor_calldata="$constructor_calldata$(endode_solidity_calldata_placeholder ${#compl_data[@]})"
          compl_data+=("$(encode_string "$arg")")
          ;;
        tuple)
          args_types=$(jq -r ".[$argument_index].components | map(.type)" <<<"$constructor_abi")
          constructor_calldata="$constructor_calldata$(encode_tuple "$args_types" "$arg")"
          ;;
        *[])
          constructor_calldata="$constructor_calldata$(endode_solidity_calldata_placeholder ${#compl_data[@]})"
          compl_data+=("$(encode_array "$arg_type" "$arg")")
          ;;
        *) _err "Unknown constructor argument type '$arg_type', use --constructor-calldata instead" ;;
        esac
      done

      for index in "${!compl_data[@]}"; do
        encoded_data_length=$(bc <<<"${#constructor_calldata} / 2")
        constructor_calldata=$(sed -E "s/$(endode_solidity_calldata_placeholder "$index")/$(printf "%064X\n" "$encoded_data_length")/" <<<"$constructor_calldata${compl_data[$index]}")
      done
    fi
  fi

  echo "Contract constructor encoded args: 0x$constructor_calldata"

  echo "Deploying compiled contract to local fork"
  contract_bytecode=$(cat ./build/"$contract_config_name".bin)
  deployment_bytecode="0x$contract_bytecode$constructor_calldata"
  deployer_account=$(_get_account "$local_rpc_url" 0)
  local_contract_address=$(_deploy_contract "$local_rpc_url" "$deployer_account" "$deployment_bytecode")
  echo "Done"
}

function compare_bytecode() {
  local remote_code
  local local_code
  local etherscan_code

  echo "Retrieving contract bytecode from local rpc (Ganache)"
  local_code=$(_get_code $local_rpc_url "$local_contract_address")

  echo -e "Retrieving contract bytecode from remote rpc ${remote_rpc_url}"
  remote_code=$(_get_code "$remote_rpc_url" "$contract_config_address")

  echo "Retrieving contract bytecode from etherscan"
  etherscan_code=$(_get_code_etherscan "$contract_config_address")

  echo "Replacing CBOR-encoded metadata"
  # https://docs.soliditylang.org/en/v0.8.9/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode
  remote_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<<"$remote_code")
  local_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<<"$local_code")
  etherscan_code=$(sed -E 's/a264697066735822[0-9a-f]{68}//' <<<"$etherscan_code")

  # https://docs.soliditylang.org/en/v0.4.24/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode
  remote_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<<"$remote_code")
  local_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<<"$local_code")
  etherscan_code=$(sed -E 's/a165627a7a72305820[0-9a-f]{68}//' <<<"$etherscan_code")

  _print_checksum local_code
  _print_checksum remote_code
  _print_checksum etherscan_code

  echo "Comparing remote and local bytecode"
  [[ "$local_code" == "$remote_code" ]] || {
    mkdir -p ./verificator_diffs
    echo "$local_code" >./verificator_diffs/"$contract"_local.bin
    echo "$remote_code" >./verificator_diffs/"$contract"_remote.bin
    _err "local bytecode and remote bytecode is not equal. Bytecode saved in ./verificator_diffs/"
  }
  echo -e "${GREEN}Local bytecode matches with remote rpc${NC}"

  echo "Comparing etherscan and local bytecode"
  [[ "$local_code" == "$etherscan_code" ]] || { _err "local bytecode and etherscan bytecode is not equal"; }
  echo -e "${GREEN}Local bytecode matches with etherscan${NC}"
}

# Internals

_get_code() {
  local rpc_url=$1
  local contract_address=$2

  curl -sS -X POST -H "Content-Type: application/json" "$rpc_url" --data "{\"jsonrpc\": \"2.0\", \"id\": 42, \"method\": \"eth_getCode\", \"params\": [\"$contract_address\", \"latest\"]}" | jq -r '.result'
}

_get_code_etherscan() {
  local contract_address=$1

  curl -sS -G -d "address=$contract_address" -d "action=eth_getCode" -d "module=proxy" -d "tag=latest" -d "apikey=$ETHERSCAN_TOKEN" https://api.etherscan.io/api | jq -r '.result'
}

_get_account() {
  local rpc_url=$1

  curl -sS -X POST -H "Content-Type: application/json" "$rpc_url" --data '{"jsonrpc": "2.0", "id": 42, "method": "eth_accounts", "params": []}' | jq -r '.result[0]'
}

_deploy_contract() {
  local rpc_url=$1
  local deployer=$2
  local data=$3

  tx_hash=$(curl -sS -X POST "$rpc_url" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$deployer\", \"to\":null,  \"gas\": \"0x1312D00\",  \"data\":\"$data\"}], \"id\":1}" -H 'Content-Type: application/json' | jq -r '.result')

  contract_address=$(curl -sS -X POST -H "Content-Type: application/json" "$rpc_url" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$tx_hash\"],\"id\":1}" | jq -r '.result.contractAddress')

  echo "$contract_address"
}

_read_contract_config() {
  local contract=$1
  local param=$2

  jq -r ".\"$contract\".\"$param\"" <"$config_json"
}

_print_checksum() {

  echo -e "${ORANGE}$1${NC} checksum: $(echo "${!1}" | $sha256sum)"
}

_err() {
  local message=$1

  echo -e "${RED}Error:${NC} $message, aborting." >&2
  exit 1
}

# Intercept ctrl+C
trap ctrl_c INT
ctrl_c() {
  if [[ "$fork_pid" -gt 0 ]]; then
    echo "Stopping ganache"
    kill -SIGTERM "$fork_pid"
  fi
  exit 0
}

# Run main
main "$@"
ctrl_c
