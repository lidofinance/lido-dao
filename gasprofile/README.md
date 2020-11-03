# Gas profiler

In order to run the profiler, either Ganache or Geth node should be running:

```sh
# run Ganache
yarn ganache

# run Geth
yarn geth
```

To profile a transaction:

1. Write a script that executes the transaction and run it using `yarn buidler-exec`.
   The script will be provided with a `web3` instance and `artifacts.require` function.
2. In the script, print the hash of the transaction that you'd like to profile.
3. Run `yarn profile`, passing the path to the solc compiler output JSON and the transaction hash.

The profile command accepts several options, you can print them by running `yarn profile --help`.


## Profiling scenarios

Test gas profiling:

```sh
# Execute several transactions
yarn buidler-exec --config ./buidler.config.test.js ./tx-test.js
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

Profile deposit:

```sh
# Execute several transactions
yarn buidler-exec ./tx-deposit.js
#
# Outputs:
#
# pool.submit tx hash: 0x9bb43602b8a755388ea75c65d7a4bff0fac30189acc5feb08a0af71654bbc56e

# Profile the tx
yarn profile ./cache/solc-output.json --src-root '..' 0x9bb43602b8a755388ea75c65d7a4bff0fac30189acc5feb08a0af71654bbc56e

# Profile the tx, skipping Aragon contracts
yarn profile ./cache/solc-output.json --src-root '..' --skip '@aragon/' 0x9bb43602b8a755388ea75c65d7a4bff0fac30189acc5feb08a0af71654bbc56e
```
