certoraRun ./contracts/0.8.9/StakingRouter.sol \
./contracts/0.6.11/deposit_contract.sol:DepositContract \
./certora/helpers/StakingModuleA.sol \
./certora/helpers/StakingModuleB.sol \
./certora/helpers/StakingModuleC.sol \
--verify StakingRouter:certora/specs/StakingRouter.spec \
\
\
--link StakingRouter:DEPOSIT_CONTRACT=DepositContract \
\
\
--solc_map StakingRouter=solc8.9,DepositContract=solc6.11,\
StakingModuleA=solc8.9,StakingModuleB=solc8.9,StakingModuleC=solc8.9 \
--loop_iter 4 \
--staging master \
--optimistic_loop \
--send_only \
--settings -copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "Staking Router"