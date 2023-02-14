certoraRun \
./certora/harness/StakingRouter.sol:StakingRouterHarness \
./contracts/0.6.11/deposit_contract.sol:DepositContract \
./certora/helpers/StakingModuleA.sol \
./contracts/0.4.24/nos/NodeOperatorsRegistry.sol \
./certora/harness/LidoMock.sol \
--verify StakingRouterHarness:certora/specs/StakingRouterInvariants.spec \
\
\
--link StakingRouterHarness:DEPOSIT_CONTRACT=DepositContract \
\
\
--solc_map StakingRouterHarness=solc8.9,DepositContract=solc6.11,LidoMock=solc6.11,\
StakingModuleA=solc8.9,NodeOperatorsRegistry=solc4.24 \
--loop_iter 4 \
--staging master \
--optimistic_loop \
--send_only \
--settings -t=500,-copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "Staking Router Invariants"