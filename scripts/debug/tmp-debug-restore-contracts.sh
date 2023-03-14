#!/bin/bash
set -e +u

declare -a contracts_with_custom_errors=(
    "0.8.9/proxy/OssifiableProxy.sol"
    "0.8.9/ValidatorExitBus.sol"
    "0.8.9/CommitteeQuorum.sol"
    "0.8.9/LidoOracleNew.sol"
    "0.8.9/test_helpers/LidoOracleNewMock.sol"
    "0.8.9/test_helpers/ValidatorExitBusMock.sol"
    "0.8.9/ReportEpochChecker.sol"
    "0.8.9/lib/RateLimitUtils.sol"
    "0.8.9/WithdrawalVault.sol"
    "0.8.9/StakingRouter.sol"
    "0.8.9/test_helpers/StakingRouterMock.sol"
    "0.8.9/WithdrawalQueue.sol"
    "0.8.9/BeaconChainDepositor.sol"
)
for f in "${contracts_with_custom_errors[@]}"
do
    mv "contracts/${f}.bkp" "contracts/${f}"
done
