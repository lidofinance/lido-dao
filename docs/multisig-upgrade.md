# Multisig app upgrade

> Please read original [multisig-deploy.md](multisig-deploy.md) before continue.

## App upgrade steps

The app upgrade process is very similar deployment steps.

Assuming we have correct `deployed-mainnet.json`.

Script allows upgrade one of the custom Lido DAO apps. Valid application names are: `lido`, `oracle` or `node-operators-registry`. It possible update one application in one pass.

> Hereinafter, we mean an upgrade of the _**oracle**_ app.
>
> Pay attention to the explicit assignment of the app name at the beginning of the some commands through an environment variable, i.e. _APP=**oracle**_.
>
> Also, be careful with files in which data for transactions is saved - the app name is automatically placed into the name, e.g. _tx-13-1-deploy-**oracle**-base.json_

## 1. Deploying the new app base implementations

### Generate transaction data files

```text
$ APP=oracle yarn hardhat --network mainnet run ./scripts/multisig/13-deploy-new-app-instance.js
========================================
Network ID: 1
Reading network state from /Users/me/lido-e2e/oracle_upgrade1/lido-dao/deployed-mainnet.json...
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

## 3. Create new voting for upgrade

To further update the application, you must perform several actions:
    * run the version update procedure in the Aragon Package Manager,
    * upgrade the version of the application inside the DAO as well as its frontend,
    * add newly introced access rights,
    * initialize new data.

Since the rights to the some of these have been transferred to the DAO, a voting must be started to
perform the version update. All these actions are applied atomically as the voting is accepted and
entacted.

Run the script to generate data for the create voting transaction:

```text
$ APP=oracle CONTENT_CID="QmPWVU6GaMRhiUhR5SSXxMWuQ9jxqSv1d6K2afyyaJT1Rb" yarn hardhat --network mainnet run ./scripts/multisig/15-vote-new-app-impl.js
========================================
Network ID: 1
Reading network state from /Users/me/lido-e2e/oracle_upgrade1/lido-dao/deployed-mainnet.json...
====================
Upgrading app: oracle
appId: 0xb2977cfc13b000b6807b9ae3cf4d938f4cc8ba98e1d68ad911c58924d6aa4f11
Contract implementation: 0xa892CCce358748429188b1554C3999a552a99cD8 -> 0x869E3cB508200D3bE0e946613a8986E8eb3E64d7
Bump version: 1,0,0 -> 2,0,0
Content URI: 0x697066733a516d505756553647614d52686955685235535358784d577551396a787153763164364b3261667979614a54315262 -> 0x697066733a516d505756553647614d52686955685235535358784d577551396a787153763164364b3261667979614a54315262
Oracle proxy address: 0x24d8451BC07e7aF4Ba94F69aCDD9ad3c6579D9FB
Voting address: 0xbc0B67b4553f4CF52a913DE9A6eD0057E2E758Db
ACL address: 0xb3CF58412a00282934D3C3E73F49347567516E98
====================
Saving data for New voting: oracle new impl transaction to tx-15-1-create-vote-new-oracle-version.json (projected gas usage is 851790)
====================
Before continuing the deployment, please send all transactions listed above.
A new voting will be created to add a new "oracle" implementation to Lido APM.
You must complete it positively and execute before continuing with the deployment!
====================
```

You may also want to explicitly specify `HOLDER=0x...`, the account that holds LDO tokens and thus
have the right to create a voting. By default, `multisigAddress` value is used here.

The step will generate the transaction file. You'll need to send these transaction:

```text
$ yarn hardhat --network mainnet tx --from $DEPLOYER --file tx-15-1-create-vote-new-oracle-version.json
```

New voting will be created. The voting must complete successfully before proceeding next.

## 4. Verify the created voting.

Collect the transaction ID from the previous step and run the 16th script like the following.

```
TX=0xf968fcc552b95e641cff14ed68101ed96dbcd9ec85609f3c70c1b849418c94ff yarn hardhat --network mainnet run ./scripts/multisig/16-verify-vote-tx.js
========================================
Network ID: 1
Reading network state from /Users/me/lido-e2e/oracle_upgrade1/lido-dao/deployed-mainnet.json...
====================
Voting contract: 0x2e59A20f205bB85a89C53f1936454680651E618e
Voting no: 63
Creator: 0xf73a1260d222f447210581DDf212D915c09a3249
All done!
```
