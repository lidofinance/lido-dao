certoraRun \
./certora/harness/NodeOperatorsRegistry.sol:NodeOperatorsRegistryHarness \
./contracts/0.8.9/Burner.sol \
./certora/harness/LidoMockStEth.sol \
--verify NodeOperatorsRegistryHarness:certora/specsCVL2/NOS_CVL2.spec \
\
\
--solc_map Burner=solc8.9,NodeOperatorsRegistryHarness=solc4.24,LidoMockStEth=solc4.24 \
--loop_iter 2 \
--cloud master \
--optimistic_loop \
--send_only \
--rule_sanity basic \
--settings -t=2800,-mediumTimeout=50,-depth=12,-copyLoopUnroll=5,-optimisticUnboundedHashing=true \
--msg "NodeOperatorsRegistry"
