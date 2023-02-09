certoraRun \
./certora/harness/StakingRouter.sol:StakingRouterHarness \
./contracts/0.6.11/deposit_contract.sol:DepositContract \
./certora/helpers/StakingModuleA.sol \
./certora/helpers/StakingModuleB.sol \
./certora/helpers/StakingModuleC.sol \
./certora/harness/LidoMock.sol \
--verify StakingRouterHarness:certora/specs/StakingRouter.spec \
\
\
--link StakingRouterHarness:DEPOSIT_CONTRACT=DepositContract \
\
\
--solc_map StakingRouterHarness=solc8.9,DepositContract=solc6.11,LidoMock=solc6.11,\
StakingModuleA=solc8.9,StakingModuleB=solc8.9,StakingModuleC=solc8.9 \
--loop_iter 4 \
--staging master \
--optimistic_loop \
--send_only \
--rule depositSanity \
--settings -copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "Staking Router "