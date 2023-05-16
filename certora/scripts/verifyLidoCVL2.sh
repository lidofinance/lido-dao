certoraRun certora/harness/LidoHarness.sol \
    certora/harness/NativeTransferFuncs.sol \
    ./contracts/0.8.9/EIP712StETH.sol \
    ./contracts/0.8.9/test_helpers/StakingRouterMockForDepositSecurityModule.sol \
    --verify LidoHarness:certora/specsCVL2/Lido.spec \
    --link NativeTransferFuncs:LIDO=LidoHarness \
    --optimistic_loop \
    --solc_map LidoHarness=solc4.24,EIP712StETH=solc8.9,StakingRouterMockForDepositSecurityModule=solc8.9,NativeTransferFuncs=solc8.9 \
    --staging \
    --loop_iter 3 \
    --settings -optimisticFallback=true,-contractRecursionLimit=1 \
    --msg "Lido all rules"