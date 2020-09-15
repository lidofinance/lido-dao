# DePool Ethereum Liquid Staking Protocol

This repository contains the Solidity smart contracts for DePool Ethereum Liquid Staking Protocol. The goal of the project is to provide liquidity for the funds staked on the Beacon chain. Users can deposit their ether to the system and get stETH token in return. stETH is a tokenized version of staked ether.

The protocol governed by DePool DAO. DAO decides on protocols’ key parameters (e.g. fees) and executes protocol upgrades. The DAO members govern the protocols to ensure their efficiency and stability.

Before getting started with this repo, please read DePool Ethereum Liquid Staking Protocol whitepaper (TODO: add relevant link here), describing how it works.

## Contracts

The protocol implemented as a set of smart contracts connected by Aragon. 

<dl>
  <dt>DePool</dt>
  <dd>Liquid staking pool implementation. The core contract that is responsible for acceptance ether from user, delegating funds to staking providers, minting liquid tokens and accept tokent for ether. DePool DAO picks validators (staking providers) and sets fee.</dd>
</dl>

<dl>
  <dt>DePoolOracle</dt>
  <dd>The goal of the oracle is to inform other parts of the system about balances controlled by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down because of slashing.</dd>
</dl>

<dl>
  <dt>StETH</dt>
  <dd>ERC20 token which represents staked ether. Supports stop/resume, mint/burn mechanics.</dd>
</dl>

<dl>
  <dt>CStETH</dt>
  <dd>ERC20 token which represents staked ether in a compound like way. Supports stop/resume, mint/burn mechanics.</dd>
</dl>

<dl>
  <dt>DePoolSwap</dt>
  <dd>The contract swaps StETH token to CStETH and vice versa.</dd>
</dl>

## Development

### Requirements 

* shell - bash or zsh
* docker
* find
* sed
* jq
* curl
* cut
* docker
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

### Building docker containers

```
docker-compose build --no-cache
```

### Starting & stopping e2e environment

E2E environment consist of two parts: ETH1 related process and ETH 2.0 related process. 

For ETH1 part: Ethereum single node (ganache), IPFS docker containers and Aragon Web App.

For ETH2 part: Beacon chain node, genesis validators machine, and, optionally 2nd and 3rd peer beacon chain nodes.

To start the whole environment, use:
```bash
./startup.sh
```
then go to [http://localhost:3000/#/depool-dao/](http://localhost:3000/#/depool-dao/) to manage DAO via Aragon Web App

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

### DKG
To build DGK container:
 
 * Add your local ssh key to github account
 * run `./dkg.sh`

### Build & test all our apps

Unit tests

```bash
npm run test
```

E2E tests

```bash
./dkg.sh
npm run test:e2e
```

#### Gas meter

In an app folder:

```bash
npm run test:gas
```

#### Generate test coverage report

For all apps, in the repo root:

```bash
npm run test:all:coverage
```

In an app folder:

```bash
npm run test:coverage
```

Test coverage is reported to `coverage.json` and `coverage/index.html` files located
inside each app's folder.

Keep in mind that the code uses `assert`s to check invariants that should always be kept
unless the code is buggy (in contrast to `require` statements which check pre-coditions),
so full branch coverage will never be reported until
[solidity-coverage#219] is implemented.

[solidity-coverage#219]: https://github.com/sc-forks/solidity-coverage/issues/269

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

