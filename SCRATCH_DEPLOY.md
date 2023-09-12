# Deploy Lido protocol from scratch

## Requirements

* node.js v16
* yarn

## General info

The repo contains bash scripts which allow to deploy the DAO under multiple environments:
- local node (ganache, anvil, hardhat network) - `dao-local-deploy.sh`
- goerli testnet - `dao-goerli-deploy.sh`

The protocol has a bunch of parameters to configure during the scratch deployment. The default configuration is stored in files `deployed-...-defaults.json`. Currently there is single default configuration `deployed-testnet-defaults.json` suitable for testnet deployments. Compared to the mainnet configuration it has lower vote durations, more frequent oracle report cycles, etc.
During the deployment, the "default" configuration is copied to file `deployed-<network name>.json` which gets populated with the contract addresses and transaction hashes during the deployment process.

## Local deployment

Deploys the DAO to local (http://127.0.0.1:8545) dev node (anvil, hardhat, ganache).
The deployment is done from default test account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
The node must be configured with the default test accounts derived from mnemonic `test test test test test test test test test test test junk`.

1. Run `yarn install` (get sure repo dependencies are installed)
2. Run the node on default port 8545 (for the commands see subsections below)
3. Set test account private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` to `accounts.json` under `/eth/local` like `"local": ["<private key>"]` (see `accounts.sample.json` for example)
4. Run the deploy script `bash dao-local-deploy.sh` from root repo directory
5. Check out the deploy artifacts in `deployed-local.json`

### Anvil

Run the node with command:

```shell
anvil -p 8545 --auto-impersonate --gas-price 0 --base-fee 0 --chain-id 1337 --mnemonic "test test test test test test test test test test test junk"
```

### Hardhat node

> NB: Hardhat node configuration is set in `hardhat.config.js` under `hardhat: { `.

To run hardhat node execute:
```shell
yarn hardhat node
```

### Ganache

TODO

## Goerli deployment

To do Goerli deployment, the following parameters must be set up via env variables:

- `DEPLOYER`. The deployer address, you must have its private key. It must have enough ether.
- `RPC_URL`. Address of of the Ethereum RPC node to use. E.g. for Infura it is `https://goerli.infura.io/v3/<yourProjectId>`
- `GAS_PRIORITY_FEE`. Gas priority fee. By default set to `2`
- `GAS_MAX_FEE`. Gas max fee. By default set to `100`
- `GATE_SEAL`. Address of the [GateSeal](https://github.com/lidofinance/gate-seals) contract. Must be deployed preliminary. Can be set to any `0x0000000000000000000000000000000000000000` to debug deployment.

Also you need to specify `DEPLOYER` private key in `accounts.json` under `/eth/goerli` like `"goerli": ["<key>"]`. See `accounts.sample.json` for an example.

Run, replacing env variables values:
```shell
DEPLOYER=0x0000000000000000000000000000000000000000 GATE_SEAL=0x0000000000000000000000000000000000000000 RPC_URL=https://goerli.infura.io/v3/yourProjectId  bash dao-goerli-deploy.sh
```
and checkout `deployed-goerli.json`.