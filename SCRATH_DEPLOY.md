# Deploy Lido protocol from scratch

Video guide: [youtube](https://www.youtube.com/watch?v=dCMXcfglJv0)

## Requirements

* shell - bash or zsh
* docker
* node.js v14
* yarn

## Environment

You will need at least:

* Ethereum node
* IPFS node
* Aragon web client

In case of local deploy this environment is set up with docker.

> Note: Lido protocol is based on Aragon framework, so the entire Aragon framework environment is required for deployment.

## DAO configuration

Dao config is stored in `deployed-{NETWORK_NAME}.json` file, where  `{NETWORK_NAME}` is network name of your choice.See the [`deployed-local-defaults.json`](deployed-local-defaults.json) for basic parameters. Please refer to [`deployed-mainnet.json`](deployed-mainnet.json) for currently deployed Mainnet version of DAO.

Copy `deployed-local-defaults.json` to `deployed-{NETWORK_NAME}.json` (e.g. `deployed-kintsugi.json`) and update it accordingly .

## Network configuration

Add to [`hardhat.config.js`](hardhat.config.js) your network connection parameter (inside the `getNetConfig` function, use `mainnet` or `local` as reference).

## Deploy process

> Note: all deploy process is depend of ENS contract. If the target network has one, you can use it. In this case, write it directly to the `deployed-{NETWORK_NAME}.json` file. Otherwise, own ENS contract will be deployed.

> Note: ETH2 Deposit contract is required. If the target network has one, you must use it. In this case, write it directly to the `deployed-{NETWORK_NAME}.json` file. Otherwise, own Deposit contract will be deployed.

Steps for deploy:

* [ ] run environment docker containers
* [ ] set up network config
* [ ] prepare DAO config file
* [ ] deploy Aragon framework environment (including ENS)
* [ ] build and deploy standard Aragon apps (contracts and frontend files)
* [ ] deploy Deposit contract (if necessary)
* [ ] deploy Lido DAO template contract
* [ ] deploy Lido Apps contract implementations
* [ ] register Lido APM name in ENS
* [ ] build Lido Apps frontend files and upload it to IPFS
* [ ] deploy Lido APM contract (via Lido Template)
* [ ] deploy Lido Apps repo contracts (via Lido Template)
* [ ] deploy Lido DAO contract (via Lido Template)
* [ ] issue DAO tokens (via Lido Template)
* [ ] finalize DAO setup (via Lido Template)
* [ ] make final deployed DAO check via script
* [ ] open and check Lido DAO web interface (via Aragon client)

All steps are automated via shell script [`dao-local-deploy.sh`](dao-local-deploy.sh) for local deploy process. The script be modified for any other network:

So, one-click local deploy from scratch command is:

```bash
./dao-local-deploy.sh
```

> Note: some steps require manually updating some transaction hashes in the `deployed-{NETWORK_NAME}.json` file. The script will pause the process in this case, please follow the script tips.
