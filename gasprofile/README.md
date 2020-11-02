# Gas profiler

Test gas profiling:

```sh
# Execute several transactions
yarn buidler-exec --config ./buidler.config.test.js ./run-tx-test.js
#
# Outputs:
#
# Foo deploy tx: 0x4a87dcd02f09423d9c6373eec026cc42f9d35e8ab1862d81b4896744453ad7cf
# Bar deploy tx: 0x30b70f748f2c4160f810c6e97e02229f7befeb425776fda1db95780318ccaf1a
#
# foo.foo tx: 0xe8decc106d166887b4868ab930c572e88318701caed27e1f35e4b2c78e9ba10d

# Profile Foo deploy tx
yarn profile ./cache/test/solc-output.json 0x4a87dcd02f09423d9c6373eec026cc42f9d35e8ab1862d81b4896744453ad7cf

# Profile Bar deploy tx
yarn profile ./cache/test/solc-output.json 0x30b70f748f2c4160f810c6e97e02229f7befeb425776fda1db95780318ccaf1a

# Profile foo.foo tx
yarn profile ./cache/test/solc-output.json 0xe8decc106d166887b4868ab930c572e88318701caed27e1f35e4b2c78e9ba10d
```

Profile DAO gas usage:

```sh
# Execute several transactions
yarn buidler-exec --config ./buidler.config.js ./run-tx.js
#
# Outputs:
#
# pool.setFee tx hash: 0xb1e910ad15ddbe14fb00fbabb5924b3ed79ba781e83448d43b2934917f521f2c

# Profile the tx
yarn profile ./cache/solc-output.json --src-root '..' 0xb1e910ad15ddbe14fb00fbabb5924b3ed79ba781e83448d43b2934917f521f2c

# Profile the tx, skipping Aragon contracts
yarn profile ./cache/solc-output.json --src-root '..' --skip '@aragon/' 0xb1e910ad15ddbe14fb00fbabb5924b3ed79ba781e83448d43b2934917f521f2c
```
