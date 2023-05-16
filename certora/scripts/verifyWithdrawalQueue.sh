certoraRun certora/harness/WithdrawalQueueHarness.sol certora/mocks/StETHMock.sol certora/harness/DummyERC20.sol \
    --verify WithdrawalQueueHarness:certora/specs/WithdrawalQueue.spec \
    --link WithdrawalQueueHarness:STETH=StETHMock \
    --link WithdrawalQueueHarness:WSTETH=DummyERC20 \
    --optimistic_loop \
    --solc_map WithdrawalQueueHarness=solc8.9,StETHMock=solc4.24,DummyERC20=solc8.9 \
    --loop_iter 3 \
    --settings -optimisticFallback=true \
    --msg "WithdrawalQueue "