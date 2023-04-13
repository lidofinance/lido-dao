#!/bin/bash
set -x
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# README
# This is a boilerplate script to simplify verification of the addresses after Shapella upgrade contracts deployment
# NB: don't forget to call `yarn clean` in case of an error

NETWORK=mainnet
TEMPORARY_ADMIN="0x2A78076BF797dAC2D25c9568F79b61aFE565B88C"

SLOTS_PER_EPOCH=32
SECONDS_PER_SLOT=12
GENESIS_TIME=1606824023
TOTAL_COVER_SHARES_BURNT=0
TOTAL_NON_COVER_SHARES_BURNT=0
HC_FOR_AO_EPOCHS_PER_FRAME=225
HC_FOR_EB_EPOCHS_PER_FRAME=56
FAST_LANE_LENGTH_SLOTS=10
DSM_MAX_DEPOSITS_PER_BLOCK=150
DSM_MIN_DEPOSIT_BLOCK_DISTANCE=25
DSM_PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS=6646

# Existing contracts
DEPOSIT_CONTRACT="0x00000000219ab540356cBB839Cbe05303d7705Fa"
WSTETH="0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"
TREASURY="0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c"  # aka agent
LIDO_PROXY="0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"
LEGACY_ORACLE_PROXY="0x442af784A788A5bd6F42A01Ebe9F287a871243fb"

# New proxies
LOCATOR_PROXY="0xC1d0b3DE6792Bf6b4b37EccdcC24e45978Cfd2Eb"
SR_PROXY=""
AO_PROXY=""
WQ_PROXY=""
EB_PROXY=""

# New contracts
LOCATOR_IMPL=""
DUMMY_CONTRACT=""
SANITY_CHECKER=""
ORACLE_DAEMON_CONFIG=""
LEGACY_ORACLE_IMPL=""
LIDO_IMPL=""
NOR_IMPL=""
BURNER=""
HC_FOR_AO=""
HC_FOR_EB=""
AO_IMPL=""
EB_IMPL=""
SR_IML=""
WQ_IMPL=""
DSM=""
EIP712=""
WITHDRAWAL_VAULT_IMPL=""

#
# Verify contracts with simple arguments
#
yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/test_helpers/DummyEmptyContract.sol:DummyEmptyContract $DUMMY_CONTRACT
yarn hardhat --network $NETWORK verify $LEGACY_ORACLE_IMPL
yarn hardhat --network $NETWORK verify $LIDO_IMPL
yarn hardhat --network $NETWORK verify $NOR_IMPL
yarn hardhat --network $NETWORK verify $BURNER $TEMPORARY_ADMIN $TREASURY $LIDO_PROXY $TOTAL_COVER_SHARES_BURNT $TOTAL_NON_COVER_SHARES_BURNT
yarn hardhat --network $NETWORK verify $HC_FOR_AO $SLOTS_PER_EPOCH $SECONDS_PER_SLOT $GENESIS_TIME $HC_FOR_AO_EPOCHS_PER_FRAME $FAST_LANE_LENGTH_SLOTS $TEMPORARY_ADMIN $AO_PROXY
yarn hardhat --network $NETWORK verify $HC_FOR_EB $SLOTS_PER_EPOCH $SECONDS_PER_SLOT $GENESIS_TIME $HC_FOR_EB_EPOCHS_PER_FRAME $FAST_LANE_LENGTH_SLOTS $TEMPORARY_ADMIN $EB_PROXY
yarn hardhat --network $NETWORK verify $AO_IMPL $LOCATOR_PROXY $LIDO_PROXY $LEGACY_ORACLE_PROXY $SECONDS_PER_SLOT $GENESIS_TIME
yarn hardhat --network $NETWORK verify $EB_IMPL $SECONDS_PER_SLOT $GENESIS_TIME $LOCATOR_PROXY
yarn hardhat --network $NETWORK verify $SR_IML $DEPOSIT_CONTRACT
yarn hardhat --network $NETWORK verify $WQ_IMPL $WSTETH "stETH Withdrawal NFT" "unstETH"
yarn hardhat --network $NETWORK verify $DSM $LIDO_PROXY $DEPOSIT_CONTRACT $SR_PROXY $DSM_MAX_DEPOSITS_PER_BLOCK $DSM_MIN_DEPOSIT_BLOCK_DISTANCE $DSM_PAUSE_INTENT_VALIDITY_PERIOD_BLOCKS
yarn hardhat --network $NETWORK verify $EIP712 $LIDO_PROXY
yarn hardhat --network $NETWORK verify $WITHDRAWAL_VAULT_IMPL $LIDO_PROXY $TREASURY


#
# Verify contracts with complex arguments
# Need to update *-args.js first
#

# # TODO: update values in ./*-args.js files. Take them from deployed-$NETWORK.json

yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/LidoLocator.sol:LidoLocator --constructor-args $SCRIPT_DIR/lidoLocator-args.js $LOCATOR_IMPL
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleReportSanityChecker-args.js $SANITY_CHECKER
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleDaemonConfig-args.js $ORACLE_DAEMON_CONFIG

#
# Verify Proxies
# It's enough to verify just a single proxy, because Etherscan will automatically match the source
# of other OssifiableProxy due to the bytecode are identical
# But need to go manually to Etherscan and confirm the contract is a proxy ater: AO, WQ, EB, LO
#

# already verified
# yarn hardhat --network $NETWORK verify $LOCATOR_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x

yarn hardhat --network $NETWORK verify $SR_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
yarn hardhat --network $NETWORK verify $AO_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
yarn hardhat --network $NETWORK verify $WQ_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
yarn hardhat --network $NETWORK verify $EB_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
