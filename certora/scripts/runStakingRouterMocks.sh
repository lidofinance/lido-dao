certoraRun \
./certora/harness/StakingRouter.sol:StakingRouterHarness \
./contracts/0.6.11/deposit_contract.sol:DepositContract \
./contracts/0.4.24/test_helpers/DepositContractMock.sol \
./certora/helpers/StakingModuleA.sol \
./certora/helpers/StakingModuleB.sol \
./certora/harness/LidoMock.sol \
--verify StakingRouterHarness:certora/specs/StakingRouter.spec \
\
\
--link StakingRouterHarness:DEPOSIT_CONTRACT=DepositContractMock \
\
\
--solc_map StakingRouterHarness=solc8.9,DepositContract=solc6.11,LidoMock=solc6.11,\
StakingModuleA=solc8.9,StakingModuleB=solc8.9,DepositContractMock=solc4.24 \
--loop_iter 2 \
--staging master \
--optimistic_loop \
--send_only \
--settings -t=1000,-copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "Staking Router DepositContractMock"