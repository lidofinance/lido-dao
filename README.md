# DePool Ethereum Liquid Staking Protocol

The DePool Ethereum Liquid Staking Protocol, built on Ethereum 2.0's Beacon chain, allows their users to earn staking rewards on Beacon chain without locking Ether or maintaining staking infrastructure. 

Users can deposit Ether to DePool smart contract and receive stETH tokens in return. The smart contract then stakes tokens with DAO-picked staking providers. Users' deposited funds are controlled by the DAO, staking providers never have direct access to the users' assets. 

Unlike staked ether, stETH token is free from the limitations associated with a lack of liquidity and can be transferred at any time. stETH token balance corresponds to the amount of Beacon chain Ether that the holder could withdraw if state transitions were enabled right now in the Ethereum 2.0 network.

Before getting started with this repo, please read:
* Whitepaper (TODO: add a link here)
* Documentation (TODO: add a link here)

## DePool DAO

The DePool DAO is a Decentralized Autonomous Organization that manages the liquid staking protocol by deciding on key parameters (e.g., setting fees, assigning staking providers and oracles, etc.) through the voting power of governance token (DPG) holders.

Also, the DAO will accumulate service fees and spend them on insurance, research, development, and protocol upgrades. Initial DAO members will take part in the threshold signature for Ethereum 2.0 by making BLS threshold signatures.

The DePool DAO is an [Aragon organization](https://aragon.org/dao). Since Aragon provides a full end-to-end framework to build DAOs, we use its standard tools. Protocol smart contracts extend AragonApp base contract and can be managed by DAO.

A full list of protocol levers that are controllable by Aragon DAO and you can found [here](docs/protocol-levers.md).

## Contracts

The protocol is implemented as a set of smart contracts that extend [AragonApp](https://github.com/aragon/aragonOS/blob/next/contracts/apps/AragonApp.sol) base contract.

#### [StETH](contracts/StETH.sol)
StETH is ERC20 token which represents staked ether. Tokens are minted upon deposit and burned when redeemed. StETH tokens are pegged 1:1 to the Ethers that are held by DePool. StETH token’s balances are updated when oracle reports change in total stake every day.

#### [DePool](contracts/DePool.sol)
DePool is a the core contract which acts as a liquid staking pool. The contract is responsible for Ether deposits and withdrawals, minting and burning liquid tokens, delegating funds to staking providers, applying fees, and accept updates from oracle contract. Staking providers' logic is extracted to the separate contract StakingProvidersRegistry.

#### StakingProvidersRegistry
Staking Providers act as validators on Beacon chain for the benefit of the protocol. The DAO selects validators and adds their addresses to StakingProvidersRegistry contract. Authorized providers have to generate a set of keys for the validation and also provide them with the smart contract. As ether is received from users, it is distributed in chunks of 32 ethers between all active Staking Providers. The contract contains a list of validators, their keys, and the logic for distributing rewards between them. The DAO can deactivate misbehaving validators.

#### [DePoolOracle](contracts/oracle/DePoolOracle.sol)
DePoolOracle is a contract where oracles send addresses' balances controlled by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down because of slashing. Oracles are assigned by DAO.

#### CStETH
It's an ERC20 token that represents the account's share of the total supply of StETH tokens. CStETH token's balance only changes on transfers, unlike StETH that is also changed when oracles report staking rewards, penalties, and slashings. It's a "power user" token that might be needed to work correctly with some DeFi protocols like Uniswap v2, cross-chain bridges, etc.

The contract also works as a wrapper that accepts StETH tokens and mints CStETH in return. The reverse exchange works exactly the opposite, received CStETH token is burned, and StETH token is returned to the user.

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

If you have `yarn` installed globally

```bash
yarn
```

otherwise

```bash
npx yarn
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
yarn run test
```

E2E tests

```bash
./dkg.sh
yarn run test:e2e
```

#### Gas meter

In an app folder:

```bash
yarn run test:gas
```

#### Generate test coverage report

For all apps, in the repo root:

```bash
yarn run test:all:coverage
```

In an app folder:

```bash
yarn run test:coverage
```

Test coverage is reported to `coverage.json` and `coverage/index.html` files located
inside each app's folder.

Keep in mind that the code uses `assert`s to check invariants that should always be kept
unless the code is buggy (in contrast to `require` statements which check pre-coditions),
so full branch coverage will never be reported until
[solidity-coverage#219] is implemented.

[solidity-coverage#219]: https://github.com/sc-forks/solidity-coverage/issues/269

### Deploying

1. Deploy Aragon APM

```bash
# Local dev network
yarn run deploy:apm:dev

# Rinkeby network
yarn run deploy:apm:rinkeby

# Mainnet network
yarn run deploy:apm:mainnet
```

2. Build and deploy Aragon applications

```bash
# Local dev network
yarn run deploy:apps:dev

# Rinkeby network
yarn run deploy:app-depool --network rinkeby
yarn run deploy:app-depooloracle --network rinkeby
yarn run deploy:app-staking-providers-registry --network rinkeby
yarn run deploy:app-steth --network rinkeby

# The same for mainnet, just replace "--network rinkeby" with "--network mainnet"
```

3. Deploy DAO template

```bash
# Local dev network
yarn run deploy:tmpl:dev
```

4. Deploy DAO

```bash
# Local dev network
yarn run deploy:dao:dev
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

