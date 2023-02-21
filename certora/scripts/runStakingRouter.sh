certoraRun \
./certora/harness/StakingRouter.sol:StakingRouterHarness \
./contracts/0.6.11/deposit_contract.sol:DepositContract \
./certora/munged/NodeOperatorsRegistry.sol \
./contracts/0.8.9/Burner.sol \
./contracts/0.8.9/LidoLocator.sol \
./certora/harness/LidoMockStEth.sol \
--verify StakingRouterHarness:certora/specs/StakingRouter.spec \
\
\
--link StakingRouterHarness:DEPOSIT_CONTRACT=DepositContract \
LidoLocator:burner=Burner \
LidoLocator:lido=LidoMockStEth \
\
\
--solc_map StakingRouterHarness=solc8.9,Burner=solc8.9,LidoLocator=solc8.9,\
DepositContract=solc6.11,\
NodeOperatorsRegistry=solc4.24,LidoMockStEth=solc4.24 \
--loop_iter 2 \
--staging master \
--optimistic_loop \
--send_only \
--settings -t=1000,-mediumTimeout=50,-copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "Staking Router"