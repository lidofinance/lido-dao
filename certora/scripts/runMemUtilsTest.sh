certoraRun ./certora/harness/MemUtilsTestSource.sol:MemUtilsTest \
--verify MemUtilsTest:certora/specs/MemUtils.spec \
\
\
--solc solc8.9 \
--loop_iter 3 \
--staging master \
--optimistic_loop \
--send_only \
--rule neverReverts \
--rule alwaysReverts \
--settings -copyLoopUnroll=4,-optimisticUnboundedHashing=true \
--msg "MemUtils test source"