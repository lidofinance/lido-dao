# DePool DAO smart contracts

## Development

### Requirements 

* shell - bash or zsh
* docker
* find
* sed
* jq
* curl
* cut
* node.js v12
* (optional) Lerna


### Installing Aragon & other deps

Installation is local and don't require root privileges.

If you have `lerna` installed globally
```bash
npm run bootstrap
```

otherwise

```bash
npx lerna bootstrap 
```

### Starting & stopping e2e environment

E2E environment consist of two parts: ETH1 related process and ETH 2.0 related process. 

For ETH1 part: Ethereum single node (ganache) and IPFS docker containers.

For ETH2 part: Beacon chain node, genesis validators machine, and, optionally 2nd and 3rd peer beacon chain nodes.

To start the whole environment, use:
 
```bash
./startup.sh
```

> To save time you can use snapshot with predeployed contracts in ETH1 chain: `./startup.sh -s `  

##### ETH1 part
During script execution, the following will be installed:
- Deposit Contract instance
- each Aragon App instance (contracts: DePool, DePoolOracle and StETH )
- Aragon PM for 'depoolspm.eth'
- DePool DAO template 
- and finally, DePool DAO will be deployed 

To start only ETH1 part use:

```bash
./startup.sh -1
```

##### ETH2 part
To work with ETH2 part, ETH1 part must be running. 

During script execution, the following will happen:
- beacon chain genesis config (Minimal with tunes) will be generated.
- validator's wallet with 4 keys will be generated
- A deposit of 32ETH will be made to Deposit Contract for each validator key.
- Based on the events about the deposit, a genesis block will be created, which including validators.
- ETH2 node with new Genesis block will start 

To reseat and restart only ETH2 part use:

```bash
./startup.sh -r2
```

##### Stop all

To stop use:
> Note: this action permanently deletes all generated data

```bash
./shutdown.sh
```

### Build & test all our apps

Unit tests

```bash
npm run test
```

E2E tests

```bash
npm run test:e2e
```

#### Gas meter

In an app folder:

```bash
npm run test:gas
```

### _(deprecated)_ Configuration

Can be specified in a local file `.dev.env`.

For options see [dev.env.default](dev.env.default).

The configuration is read only during new dao deployment.


### _(deprecated)_ New dao creation

```bash
./bin/deploy-dev-contracts.sh
```

The GUI for the created DAO can be accessed at `http://localhost:3000/?#/<dao_address>/`.

Note: `DAO_ID` must be unique in a blockchain.

### Other

To reset the devchain state, stop the processes and use:

```bash
./shutdown.sh && ./startup.sh
```

or to just clean restart

```bash
./startup.sh -r -s
```

You free to mix the keys.

