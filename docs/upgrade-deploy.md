# Deploy Lido contracts on upgrades

To help with deploying contracts on upgrades there are scripts under [scripts/upgrade](/scripts/upgrade).

## Deploy LidoLocator

E. g. to deploy `LidoLocator` implementation with new addresses for `legacyOracle` and `postTokenRebaseReceiver`
on Sepolia run

```shell
legacyOracle=<PUT-YOU-VALUE> \
postTokenRebaseReceiver=<PUT-YOU-VALUE> \
GAS_MAX_FEE=100 GAS_PRIORITY_FEE=2 \
DEPLOYER=<PUT-YOU-VALUE> \
RPC_URL=<PUT-YOU-VALUE> \
yarn hardhat --network sepolia run --no-compile scripts/upgrade/deploy-locator.ts
```

specifying require values under `<PUT-YOU-VALUE>`.
