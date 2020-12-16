# Validating docker deploy before test
✅token.test.js

✅deposit.test.js

✅dao.test.js

✅voting.test.js

# FullFlow test
✅Check dao apps are deployed

✅Add oracle members'

✅Set quorum

✅Set withdrawal credentials

✅Set basic fee(10%)

✅Set fee distribution(treasury - 0%,insurance -10%,nodeOperator - 90%)

✅Add nodeOperator1 and add signing keys

✅Add nodeOperator2 and add signing keys

✅Add nodeOperator3 and add signing keys

✅Deposit 2 ETH to Lido via Lido from user1

✅Deposit 30 ETH to Lido via Lido from user1

✅Deposit 2 ETH to Lido via Lido from user2

✅Deposit 32 ETH to Lido via Lido  from user2

✅Deposit 222 ETH to Lido via Lido from user3

✅Deposit 32 ETH to Lido via deposit contract from user4
check that validator is up??

✅Deposit 288 ETH to Lido via Lido from user3

✅Convert some stEthToken to cstToken

✅Chek that the nodeOperators keys became using

✅Wait for validators activation(~150 sec)

✅Check that the validators have been activated

✅Check that the network is producing and finalizing blocks

✅Waiting for the validator to receive a reward ~30 sec

✅Check that the users balances in stEthToken changed and cStEthToken stay the same

✅Convert cstEthToken back to stEthToken

X Reproduce penalties and check that the users balances changed correctly due to mint/burn of token

✅Change withdrawal credentials

✅Check that unused signing keys removed from nodeOperators due to changed withdrawal credentials

✅Set full nodeOperator permissions to nodeOperator4

✅Add nodeOperator4 and add signing keys

✅Check the correctness of nodeOperator4

✅Change nodeOperator4 name and rewardAddress

✅Check deposit iteration limit(deposit more than 16 keys in one transaction)

✅Check that the rest of buffered Ether in the pool can be submitted

✅Check that the validators have been activated

✅Deactivate nodeOperator4 with currently using signing keys

✅Waiting for the validator to receive a rewards and check that the deactivated provider balance not changed

✅Check that the rewards have been split between nos1,nos2,nos3 due to nos4 was deactivated

✅Check that the users receive appropriate amount of stEthTokens by validators rewards

✅Increase the staking limit for node operator

✅Reduce the staking limit for node operator

✅Change withdrawal credentials.

✅Check that unused signing keys removed from nodeOperators due to changed withdrawal credentials

✅Check that the validators do not activate if there are no unused signing keys.

X Test insurance (pending for the actual insurance)
