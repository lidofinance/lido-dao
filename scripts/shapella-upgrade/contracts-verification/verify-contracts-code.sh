#!/bin/bash
set -x
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# README
# This is a boilerplate script to simplify verification of the addresses after Shapella upgrade contracts deployment
# NB: don't forget to call `yarn clean` in case of an error

NETWORK=goerlishapella
TEMPORARY_ADMIN="0xa5F1d7D49F581136Cf6e58B32cBE9a2039C48bA1"

SECONDS_PER_SLOT=12
GENESIS_TIME=1616508000
DEPOSIT_CONTRACT="0xff50ed3d0ec03aC01D4C79aAd74928BFF48a7b2b"
WSTETH="0x6320cD32aA674d2898A68ec82e869385Fc5f7E2f"
TREASURY="0x4333218072D5d7008546737786663c38B4D561A4"

DUMMY_CONTRACT="0x6A03b1BbB79460169a205eFBCBc77ebE1011bCf8"
LOCATOR_IMPL="0xa55bBf0245890fC5F5A231778732b8966300a80e"

SR_PROXY="0xa3Dbd317E53D363176359E10948BA0b1c0A4c820"
AO_PROXY="0x76f358A842defa0E179a8970767CFf668Fc134d6"
WQ_PROXY="0xCF117961421cA9e546cD7f50bC73abCdB3039533"
EB_PROXY="0x712198c5459bCCf09f4603F203a9b73d139Ad280"
LOCATOR_PROXY="0x1eDf09b5023DC86737b59dE68a8130De878984f5"

LIDO_PROXY="0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F"
LEGACY_ORACLE_PROXY="0x24d8451BC07e7aF4Ba94F69aCDD9ad3c6579D9FB"
SANITY_CHECKER="0x9Ae2Ead18B2Fe57647da4d1fD881A9723946f666"
ORACLE_DAEMON_CONFIG="0xad55833Dec7ab353B47691e58779Bd979d459388"
LEGACY_ORACLE_IMPL="0x7D505d1CCd49C64C2dc0b15acbAE235C4651F50B"
LIDO_IMPL="0xEE227CC91A769881b1e81350224AEeF7587eBe76"
NOR_IMPL="0xCAfe9Ac6a4bE2eAfCFf949693C0da9eebF985C3B"
BURNER="0x20c61C07C2E2FAb04BF5b4E12ce45a459a18f3B1"
HC_FOR_AO="0x8EA83346E60261DdF1fA3B64056B096e337541b2"
HC_FOR_EB="0x8D4bCbc063da5A813FC13c3f4c817afcA7cb1eD6"
AO_IMPL="0x8C55A49639b456F98E1A8D7DAa3b29B378CADc8b"
EB_IMPL="0x304F1B78B975AB79B479AdA70cE2Fc9A5a1A2a54"
SR_IML="0x249565350CcaD707bB68cE9980B366751649F4cd"
WQ_IMPL="0x265be9738fA32B29180867E07eaf1d6fa02a34dB"
DSM="0xdBC149BaAC351A1102E48B91D7073fd36da24694"
EIP712="0xB4300103FfD326f77FfB3CA54248099Fb29C3b9e"
WITHDRAWAL_VAULT_IMPL="0x297Eb629655C8c488Eb26442cF4dfC8A7Cc32fFb"

#
# Verify contracts with simple arguments
#
yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/test_helpers/DummyEmptyContract.sol:DummyEmptyContract $DUMMY_CONTRACT
yarn hardhat --network $NETWORK verify $LEGACY_ORACLE_IMPL
yarn hardhat --network $NETWORK verify $LIDO_IMPL
yarn hardhat --network $NETWORK verify $NOR_IMPL
yarn hardhat --network $NETWORK verify $BURNER
yarn hardhat --network $NETWORK verify $HC_FOR_AO 32 $SECONDS_PER_SLOT $GENESIS_TIME 40 10 $TEMPORARY_ADMIN $AO_PROXY
yarn hardhat --network $NETWORK verify $HC_FOR_EB 32 $SECONDS_PER_SLOT $GENESIS_TIME 20 10 $TEMPORARY_ADMIN $EB_PROXY
yarn hardhat --network $NETWORK verify $AO_IMPL $LOCATOR_PROXY $LIDO_PROXY $LEGACY_ORACLE_PROXY $SECONDS_PER_SLOT $GENESIS_TIME
yarn hardhat --network $NETWORK verify $EB_IMPL $SECONDS_PER_SLOT $GENESIS_TIME $LOCATOR_PROXY
yarn hardhat --network $NETWORK verify $SR_IML $DEPOSIT_CONTRACT
yarn hardhat --network $NETWORK verify $WQ_IMPL $WSTETH "stETH Withdrawal NFT" "unstETH"
yarn hardhat --network $NETWORK verify $DSM $LIDO_PROXY $DEPOSIT_CONTRACT $SR_PROXY 150 5 6646
yarn hardhat --network $NETWORK verify $EIP712 $LIDO_PROXY
yarn hardhat --network $NETWORK verify $WITHDRAWAL_VAULT_IMPL $LIDO_PROXY $TREASURY


#
# Verify contracts with complex arguments
# Need to update *-args.js first
#

# TODO: update values in ./*-args.js files. Take them from deployed-$NETWORK.json

yarn hardhat --network $NETWORK verify --contract contracts/0.8.9/LidoLocator.sol:LidoLocator --constructor-args $SCRIPT_DIR/lidoLocator-args.js $LOCATOR_IMPL
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleReportSanityChecker-args.js $SANITY_CHECKER
yarn hardhat --network $NETWORK verify --constructor-args $SCRIPT_DIR/oracleDaemonConfig-args.js $ORACLE_DAEMON_CONFIG

#
# Verify Proxies
# It's enough to verify just a single proxy, because Etherscan will automatically match the source
# of other OssifiableProxy due to the bytecode are identical
# But need to go manually to Etherscan and confirm the contract is a proxy ater: AO, WQ, EB, LO
#
yarn hardhat --network $NETWORK verify $SR_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
# yarn hardhat --network $NETWORK verify $AO_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
# yarn hardhat --network $NETWORK verify $WQ_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
# yarn hardhat --network $NETWORK verify $EB_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
# yarn hardhat --network $NETWORK verify $LOCATOR_PROXY $DUMMY_CONTRACT $TEMPORARY_ADMIN 0x
