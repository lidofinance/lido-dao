certoraRun certora/harness/LidoHarness.sol \
    --verify LidoHarness:certora/specsCVL2/StEth.spec \
    --optimistic_loop \
    --solc solc4.24 \
    --staging \
    --loop_iter 3 \
    --settings -optimisticFallback=true \
    --msg "StEth - privilegedOperation"
