#!/bin/bash
set -ex
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# README
# This is a boilerplate script to simplify verification of the addresses after Shapella upgrade contracts deployment

NETWORK= # e.g.: goerlishapella
TEMPORARY_ADMIN=

DUMMY_CONTRACT=
LIDO_LOCATOR_IMPL=
SR_PROXY=
AO_PROXY=
WQ_PROXY=
EB_PROXY=
LO_PROXY=
SANITY_CHECKER=
ORACLE_DAEMON_CONFIG=
LEGACY_ORACLE_IMPL=
LIDO_IMPL=
NOR_IMPL=
BURNER=
HC_FOR_AO=
HC_FOR_EB=
AO_IMPL=
EB_IMPL=
SR_IML=
WQ_IMPL=
DSM=
EIP712=
WITHDRAWAL_VAULT=
BEACON_CHAIN_DEPOSITOR=

#
# Verify contracts with simple arguments
#

# TODO: add missing arguments

yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/test_helpers/DummyEmptyContract.sol:DummyEmptyContract $DUMMY_CONTRACT
yarn hardhat --network $NETWORK verify $LIDO_LOCATOR_IMPL
yarn hardhat --network $NETWORK verify $DUMMY_CONTRACT
yarn hardhat --network $NETWORK verify $SR_PROXY
yarn hardhat --network $NETWORK verify $AO_PROXY
yarn hardhat --network $NETWORK verify $WQ_PROXY
yarn hardhat --network $NETWORK verify $EB_PROXY
yarn hardhat --network $NETWORK verify $LO_PROXY
yarn hardhat --network $NETWORK verify $SANITY_CHECKER
yarn hardhat --network $NETWORK verify $LEGACY_ORACLE_IMPL
yarn hardhat --network $NETWORK verify $LIDO_IMPL
yarn hardhat --network $NETWORK verify $NOR_IMPL
yarn hardhat --network $NETWORK verify $BURNER
yarn hardhat --network $NETWORK verify $HC_FOR_AO
yarn hardhat --network $NETWORK verify $HC_FOR_EB
yarn hardhat --network $NETWORK verify $AO_IMPL
yarn hardhat --network $NETWORK verify $EB_IMPL
yarn hardhat --network $NETWORK verify $SR_IML
yarn hardhat --network $NETWORK verify $WQ_IMPL
yarn hardhat --network $NETWORK verify $DSM
yarn hardhat --network $NETWORK verify $EIP712
yarn hardhat --network $NETWORK verify $WITHDRAWAL_VAULT
yarn hardhat --network $NETWORK verify $BEACON_CHAIN_DEPOSITOR


#
# Verify contracts with complex arguments
# Need to update *-args.js first
#

# TODO: update values in ./*-args.js files. Take them from deployed-$NETWORK.json

yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/LidoLocator.sol:LidoLocator --constructor-args $SCRIPT_DIR/lidoLocator-args.js $LIDO_LOCATOR_IMPL
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleReportSanityChecker-args.js $SANITY_CHECKER_IMPL
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleDaemonConfig-args.js $ORACLE_DAEMON_CONFIG

#
# Verify Proxies
# It's enough to verify just a single proxy, because Etherscan will automatically match the source
# of other OssifiableProxy due to the bytecode are identical
# But need to go manually to Etherscan and confirm the contract is a proxy ater: AO, WQ, EB, LO
#
yarn hardhat --network $NETWORK verify $SR_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
