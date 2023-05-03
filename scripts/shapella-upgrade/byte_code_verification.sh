#!/usr/bin/env bash

RED='\033[0;31m'
ORANGE='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
cd "${SCRIPT_DIR}"

# Environment vailable required
envs=(REMOTE_RPC CONFIG WEB3_INFURA_PROJECT_ID ETHERSCAN_TOKEN)
for e in "${envs[@]}"; do
  [[ "${!e:+isset}" == "isset" ]] || { _err "${e} env var is required but is not set"; }
done

local_rpc_port=7776
local_rpc_url=http://127.0.0.1:${local_rpc_port}
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

echo -e ${ORANGE} "Starting local fork \"${local_fork_command}\""
(nc -vz 127.0.0.1 $local_rpc_port) &>/dev/null && kill -SIGTERM "$(lsof -t -i:$local_rpc_port)"

$local_fork_command 1>>./logs 2>&1 &
fork_pid=$$
echo -e ${ORANGE} "Ganache pid $fork_pid"

sleep 10


# Intercept ctrl+C
trap ctrl_c INT
ctrl_c() {
  if [[ "$fork_pid" -gt 0 ]]; then
    echo -e ${ORANGE} "Stopping ganache"
    kill -SIGTERM "$fork_pid"
  fi
  exit 0
}

confirm_yn() {
  while true; do
    read -p "$1 contract verification done. Do you wish to continue? " yn
    case $yn in
        [Yy]* ) break;;
        [Nn]* ) exit 1;;
        * ) echo -e ${ORANGE} "Please answer yes or no.";;
    esac
  done
}

start_fork

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing accountingOracle proxy.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract accountingOracle --proxy --local-ganache
confirm_yn accountingOracle

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing validatorsExitBusOracle proxy.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract validatorsExitBusOracle --proxy --local-ganache --skip-compilation
confirm_yn validatorsExitBusOracle

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing stakingRouter proxy.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract stakingRouter --proxy --local-ganache --skip-compilation
confirm_yn stakingRouter

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing withdrawalQueueERC721 proxy.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract withdrawalQueueERC721 --proxy --local-ganache --skip-compilation
confirm_yn withdrawalQueueERC721



echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE}  Comparing lidoLocator implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract lidoLocator --implementation --local-ganache --skip-compilation
confirm_yn lidoLocator

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE}  Comparing accountingOracle implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract accountingOracle --implementation --local-ganache --skip-compilation
confirm_yn accountingOracle

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE}  Comparing validatorsExitBusOracle implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract validatorsExitBusOracle --implementation --local-ganache --skip-compilation
confirm_yn validatorsExitBusOracle

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing stakingRouter implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract stakingRouter --implementation --local-ganache --skip-compilation
confirm_yn stakingRouter

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing withdrawalQueueERC721 implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract withdrawalQueueERC721 --implementation --local-ganache --skip-compilation
confirm_yn withdrawalQueueERC721

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing withdrawalVault implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract withdrawalVault --implementation --local-ganache --skip-compilation
confirm_yn withdrawalVault




echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing dummyEmptyContract implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract dummyEmptyContract --local-ganache --skip-compilation
confirm_yn dummyEmptyContract

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing depositSecurityModule.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract depositSecurityModule --local-ganache --skip-compilation
confirm_yn depositSecurityModule

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing OracleReportSanityChecker.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract oracleReportSanityChecker --constructor-calldata 000000000000000000000000c1d0b3de6792bf6b4b37eccdcc24e45978cfd2eb0000000000000000000000003e40d73eb977dc6a537af587d48316fee66e9c8c0000000000000000000000000000000000000000000000000000000000009c4000000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000003e8000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000b71b0000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 --local-ganache --skip-compilation
confirm_yn OracleReportSanityChecker

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing oracleDaemonConfig.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract oracleDaemonConfig --local-ganache --skip-compilation
confirm_yn oracleDaemonConfig

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing eip712StETH.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract eip712StETH --local-ganache --skip-compilation
confirm_yn eip712StETH

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing burner.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract burner --local-ganache --skip-compilation
confirm_yn burner

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing hashConsensusForAccounting.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract hashConsensusForAccounting --local-ganache --skip-compilation
confirm_yn hashConsensusForAccounting

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing hashConsensusForValidatorsExitBus.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.8.9 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract hashConsensusForValidatorsExitBus --local-ganache --skip-compilation
confirm_yn hashConsensusForValidatorsExitBus




echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing Legacy oracle.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.4.24 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract app:oracle --implementation --local-ganache
confirm_yn LegacyOracle

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing Node operators registry implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.4.24 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract app:node-operators-registry --implementation --local-ganache --skip-compilation
confirm_yn app:node-operators-registry

echo -e ${ORANGE}  ================================================${NC}
echo -e ${ORANGE} Comparing Lido implementation.${NC}
echo -e ${ORANGE}  ================================================${NC}
../../bytecode-verificator/bytecode_verificator.sh  --solc-version 0.4.24 --remote-rpc-url $REMOTE_RPC --config-json $CONFIG --contract app:lido --implementation --local-ganache --skip-compilation
confirm_yn Lido
