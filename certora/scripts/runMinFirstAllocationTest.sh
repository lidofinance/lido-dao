certoraRun \
./certora/harness/MinFirstAllocationStrategyTest.sol \
--verify MinFirstAllocationStrategyTest:certora/specs/MinFirstAllocation.spec \
\
--solc solc8.9 \
--loop_iter 5 \
--staging master \
--optimistic_loop \
--send_only \
--msg "MinFirstAllocationStrategyTest"