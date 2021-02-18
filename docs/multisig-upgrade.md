# Multisig app upgrade

> Please read original [multisig-deploy.md](multisig-deploy.md) before continue.

## App upgrade steps

The app upgrade process is very similar deployment steps.

Assuming we have correct `deployed-mainnet.json`.

Script allows upgrade one of the custom Lido DAO apps. Valid application names are: `lido`, `oracle` or `node-operators-registry`. It possible update one application in one pass.

## 1. Deploying the new app base implementations

### Generate transaction data files

> Hereinafter, we mean an upgrade of the `oracle` app.
> Pay attention to the explicit assignment of the app name hereinafter at the beginning of the some commands through an environment variable, i.e. `APP=oracle`.
> Also, be careful with files in which data for transactions is saved - the app name is automatically placed into the name, e.g. `tx-13-1-deploy-**oracle**-base.json`

```text
$ APP=oracle yarn hardhat --network mainnet run ./scripts/multisig/13-deploy-new-app-instance.js
========================================
Network ID: 1
Reading network state from /Users/me/lido-e2e/oracle_upgrade1/lido-dao/deployed-e2e.json...
====================
Saving deploy TX data for LidoOracle to tx-13-1-deploy-oracle-base.json
====================
Before continuing the deployment, please send all contract creation transactions
that you can find in the files listed above. You may use a multisig address
if it supports deploying new contract instances.
====================
All done!
```

### Send the transactions

> See [multisig-deploy.md](multisig-deploy.md#send-the-transactions) for details.

Run the following to deploy the new implementation:

```text
$ yarn hardhat --network mainnet tx --from $DEPLOYER --file tx-13-1-deploy-oracle-base.json
```

### Update the network state file

After transaction is included in the blockchain, update the corresponded app section in the network
state file with the following values:

* `oracleBaseDeployTx` hash of the TX sent from the `tx-13-1-deploy-oracle-base.json` file

## 2. Verifying the deployed contracts

Run the following:

```text
$ APP=oracle yarn hardhat --network mainnet run ./scripts/multisig/14-obtain-deployed-new-app-instance
```

This step will verify the deployed contract and update the following field to the network state file:

* `app:oracle.baseAddress` address of the `LidoOracle` implementation contract

## 3. Create new voting to update PM app version

To further update the application, you must first perform the version update procedure in the Package Manager.
Since the rights to the Package Manager have been transferred to the DAO, a voting must be started to perform the version update.

> Note: this script so far only updates the contract address of the app, not the contentUri of the web part of the app.

Run the script to generate data for the create voting transaction:

```text
$ APP=oracle yarn hardhat --network mainnet run ./scripts/multisig/15-vote-new-app-impl.js
...
====================
Upgrading app: oracle
appId: 0x8b47ba2a8454ec799cd91646e7ec47168e91fd139b23f017455f3e5898aaba93
Contract implementation: 0xd7aca8b7F5E6668b2D7349C52390e206249cFb04 -> 0x9b2bd23CC47A75Cb3Bae88EB7384F01b3ae53bC8
Bump version: 1,0,0 -> 2,0,0
====================
Saving data for New voting: oracle new impl transaction to tx-15-1-create-vote-new-oracle-version.json (projected gas usage is 1988060)
====================
Before continuing the deployment, please send all transactions listed above.
A new voting will be created to add a new "oracle" implementation to Lido APM.
You must complete and execute it positively before continuing with the deployment!
====================
```

The step will generate the transaction file. You'll need to send these transaction:

```text
$ yarn hardhat --network mainnet tx --from $DEPLOYER --file tx-15-1-create-vote-new-oracle-version.json
```

New voting will be created. The voting must complete successfully before proceeding next.

## 4. Create new voting to upgrade DAO app

After updating the app version in the Package Manager, you need to upgrade the version of the application inside the DAO. To do this, you need to vote again.

Run the script to generate data for the create voting transaction:

```text
$ yarn hardhat --network mainnet run ./scripts/multisig/16-vote-new-app-upgrade.js
...
====================
Upgrading app: oracle
appId: 0x8b47ba2a8454ec799cd91646e7ec47168e91fd139b23f017455f3e5898aaba93
Using DAO app namespace: 0xf1f3eb40f5bc1ad1344716ced8b8a0431d840b5783aea1fd01786bc26f35ac0f
App contract base: 0xd7aca8b7F5E6668b2D7349C52390e206249cFb04 -> 0x9b2bd23CC47A75Cb3Bae88EB7384F01b3ae53bC8
====================
Saving data for New voting: oracle app upgrade transaction to tx-16-1-create-vote-oracle-upgrade.json (projected gas usage is 1663035)
====================
Before continuing the deployment, please send all transactions listed above.
A new voting will be created to upgrade "oracle" app to latest version.
You must complete it positively and execute before continuing with the deployment!
====================
...
```

The step will generate the transaction file. You'll need to send these transaction:

```text
$ yarn hardhat --network mainnet tx --from $DEPLOYER --file tx-16-1-create-vote-oracle-upgrade.json
```

New voting will be created. The voting must complete successfully to finish app upgrade.
