# Deploy Lido protocol from scratch

## Requirements

* node.js v16
* yarn

## Local deployment

Deploys the DAO to local (http://127.0.0.1:8545) dev node (anvil, hardhat, ganache).
The deployment is done from default test account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
The node must be configured with the default test accounts derived from mnemonic `test test test test test test test test test test test junk`.

1. Run `yarn install` (get sure repo dependencies are installed)
2. Run the node on default port 8545 (for the commands see subsections below)
3. Set test account private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` to `accounts.json` under `/eth/local` like `"local": ["<private key>"]`
4. Run the deploy script `bash dao-local-deploy.sh` from root repo directory
5. Check out the deploy artifacts in `deployed-local.json`

### Anvil

Run the node with command:

```shell
anvil -p 8545 --auto-impersonate --gas-price 0 --base-fee 0 --chain-id 1337 --mnemonic "test test test test test test test test test test test junk"
```

### Hardhat node

> NB: Hardhat node is configured in `hardhat.config.js` under `hardhat: { `.

To run hardhat node execute:
```shell
yarn hardhat node
```
